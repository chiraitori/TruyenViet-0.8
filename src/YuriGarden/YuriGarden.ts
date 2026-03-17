import {
    TagSection,
    SourceManga,
    Chapter,
    ChapterDetails,
    HomeSection,
    HomeSectionType,
    SearchRequest,
    PagedResults,
    Request,
    Response,
    ChapterProviding,
    MangaProviding,
    SearchResultsProviding,
    HomePageSectionsProviding,
    SourceInfo,
    ContentRating,
    SourceIntents,
    BadgeColor,
} from '@paperback/types';

import { Parser } from './YuriGardenParser';

const DOMAIN = 'https://yurigarden.com';
const API_DOMAIN = 'https://api.yurigarden.com';

export const YuriGardenInfo: SourceInfo = {
    version: '1.0.1',
    name: 'YuriGarden',
    icon: 'icon.png',
    author: 'TruyenViet',
    authorWebsite: 'https://github.com/chiraitori',
    description: 'Extension that pulls manga from YuriGarden.',
    contentRating: ContentRating.ADULT,
    websiteBaseURL: DOMAIN,
    sourceTags: [
        {
            text: 'Yuri',
            type: BadgeColor.GREEN
        },
        {
            text: 'Cloudflare',
            type: BadgeColor.RED
        }
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED
};

export class YuriGarden implements SearchResultsProviding, MangaProviding, ChapterProviding, HomePageSectionsProviding {

    stateManager = App.createSourceStateManager();

    readonly requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 50000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        'referer': `${DOMAIN}/`,
                        'origin': DOMAIN,
                        'x-app-origin': DOMAIN,
                        'x-custom-lang': 'vi',
                        'user-agent': await this.requestManager.getDefaultUserAgent(),
                    }
                };
                return request;
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response;
            }
        }
    });

    getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}/comic/${mangaId}`;
    }

    parser = new Parser();

    private async getR18(): Promise<boolean> {
        return (await this.stateManager.retrieve('r18') as boolean) ?? false;
    }

    private async getAPI(url: string): Promise<string> {
        const request = App.createRequest({
            url: url,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, 1);

        let isCloudflareError = response.status === 403 || response.status === 503;

        if (!isCloudflareError && response.data) {
            try {
                const dataObj = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
                if (dataObj.statusCode === 403 || dataObj.message === 'Forbidden') {
                    isCloudflareError = true;
                }
            } catch (e) {
                // might be HTML from Cloudflare challenge page
                const dataStr = String(response.data);
                if (dataStr.includes('cf-turnstile') || dataStr.includes('challenge-platform')) {
                    isCloudflareError = true;
                }
            }
        }

        if (isCloudflareError) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to home page ${YuriGardenInfo.name} source and press the cloud icon.`);
        }

        return typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        return App.createRequest({
            url: `${DOMAIN}/comic/466/4846`,
            method: 'GET',
            headers: {
                'referer': `${DOMAIN}/`,
                'origin': DOMAIN,
                'user-agent': await this.requestManager.getDefaultUserAgent()
            }
        });
    }

    async getSourceMenu(): Promise<any> {
        return App.createDUISection({
            id: 'main',
            header: 'Source Settings',
            isHidden: false,
            rows: async () => [
                App.createDUISwitch({
                    id: 'r18',
                    label: 'Enable R18 Content',
                    value: App.createDUIBinding({
                        get: async () => (await this.stateManager.retrieve('r18') as boolean) ?? false,
                        set: async (newValue: boolean) => await this.stateManager.store('r18', newValue),
                    }),
                }),
            ],
        });
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const json = JSON.parse(await this.getAPI(`${API_DOMAIN}/api/comics/${mangaId}`));
        return this.parser.parseMangaDetails(json, mangaId);
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const json = JSON.parse(await this.getAPI(`${API_DOMAIN}/api/chapters/comic/${mangaId}`));
        return this.parser.parseChapterList(json);
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const json = JSON.parse(await this.getAPI(`${API_DOMAIN}/api/chapters/pages/${chapterId}`));
        const pages = this.parser.parseChapterDetails(json);
        return App.createChapterDetails({
            id: chapterId,
            mangaId: mangaId,
            pages: pages,
        });
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const r18 = await this.getR18();

        const tags = query.includedTags?.map(tag => tag.id) ?? [];
        let statusFilter = '';
        const genreTags: string[] = [];

        for (const tag of tags) {
            if (tag.startsWith('status.')) {
                statusFilter = tag.split('.')[1] ?? '';
            } else {
                genreTags.push(tag);
            }
        }

        let url = `${API_DOMAIN}/api/comics?page=${page}&limit=20&r18=${r18}`;

        if (query.title) {
            url += `&search=${encodeURIComponent(query.title)}`;
        }

        if (statusFilter) {
            url += `&status=${statusFilter}`;
        }

        if (genreTags.length > 0) {
            url += `&genres=${genreTags.join(',')}`;
        }

        const json = JSON.parse(await this.getAPI(url));
        const tiles = this.parser.parseSearchResults(json);
        const totalPages = json.totalPages ?? 1;
        metadata = (page < totalPages) ? { page: page + 1 } : undefined;

        return App.createPagedResults({
            results: tiles,
            metadata
        });
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        console.log('YuriGarden Running...');
        const r18 = await this.getR18();
        const sections: HomeSection[] = [
            App.createHomeSection({ id: 'new_updated', title: 'Mới Cập Nhật', containsMoreItems: true, type: HomeSectionType.singleRowNormal }),
        ];

        for (const section of sections) {
            sectionCallback(section);
            let url: string;
            switch (section.id) {
                case 'new_updated':
                    url = `${API_DOMAIN}/api/comics?page=1&limit=20&r18=${r18}`;
                    break;
                default:
                    throw new Error('Invalid home section ID');
            }

            const json = JSON.parse(await this.getAPI(url));
            switch (section.id) {
                case 'new_updated':
                    section.items = this.parser.parseSearchResults(json);
                    break;
            }
            sectionCallback(section);
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        const page: number = metadata?.page ?? 1;
        const r18 = await this.getR18();
        let url = '';

        switch (homepageSectionId) {
            case 'new_updated':
                url = `${API_DOMAIN}/api/comics?page=${page}&limit=20&r18=${r18}`;
                break;
            default:
                throw new Error('Requested to getViewMoreItems for a section ID which doesn\'t exist');
        }

        const json = JSON.parse(await this.getAPI(url));
        const manga = this.parser.parseSearchResults(json);
        const totalPages = json.totalPages ?? 1;
        metadata = (page < totalPages) ? { page: page + 1 } : undefined;

        return App.createPagedResults({
            results: manga,
            metadata
        });
    }

    async getSearchTags(): Promise<TagSection[]> {
        return this.parser.parseTags();
    }
}
