import {
    Tag,
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
    PartialSourceManga,
    DUISection,
} from '@paperback/types';

declare const require: any;
const CryptoJS: any = require('crypto-js');

const DOMAIN = 'https://yurigarden.com/';
const API_DOMAIN = 'https://api.yurigarden.com/';
const STORE_DOMAIN = 'https://db.yurigarden.com/storage/v1/object/public/yuri-garden-store/';

const normalizeImageUrl = (path?: string): string => {
    if (!path) return 'https://i.imgur.com/GYUxEX8.png';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return `${STORE_DOMAIN}${path.replace(/^\/+/, '')}`;
};

const mapStatus = (status?: string): string => {
    switch ((status ?? '').toLowerCase()) {
        case 'ongoing':
            return 'ONGOING';
        case 'completed':
            return 'COMPLETED';
        case 'oncoming':
        case 'hiatus':
            return 'ON_HIATUS';
        default:
            return 'UNKNOWN';
    }
};

const pickFirstNumeric = (value: string): string | undefined => {
    const match = value.match(/\d+/);
    return match?.[0];
};

const extractMangaId = (input: unknown): string => {
    if (typeof input === 'number' && Number.isFinite(input)) return String(input);
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('Missing manga ID');
    if (/^\d+$/.test(raw)) return raw;
    const comicRoute = raw.match(/\/comic\/(\d+)/i)?.[1];
    if (comicRoute) return comicRoute;
    const numeric = pickFirstNumeric(raw);
    if (numeric) return numeric;
    throw new Error(`Unable to extract manga ID from value: ${raw}`);
};

const extractChapterId = (input: unknown): string => {
    if (typeof input === 'number' && Number.isFinite(input)) return String(input);
    const raw = String(input ?? '').trim();
    if (!raw) throw new Error('Missing chapter ID');
    if (/^\d+$/.test(raw)) return raw;
    const chapterRoute = raw.match(/\/comic\/\d+\/(\d+)/i)?.[1];
    if (chapterRoute) return chapterRoute;
    const numeric = pickFirstNumeric(raw);
    if (numeric) return numeric;
    throw new Error(`Unable to extract chapter ID from value: ${raw}`);
};

// ── Decryption ───────────────────────────────────────────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const FACTORIAL_TABLE = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];

const buildDecryptPassphrase = (): string => {
    const a = new Uint8Array([84, 122, 83, 44]);
    const b = new Uint8Array([53, 45, 64, 230]);
    const c = new Uint8Array([220, 207, 245, 148]);
    const d = new Uint8Array([184, 136, 188, 119]);
    const x = new Uint8Array([18, 35, 52, 69]);
    const y = new Uint8Array([86, 103, 120, 137]);
    const z = new Uint8Array([154, 171, 188, 205]);
    const w = new Uint8Array([222, 239, 240, 1]);

    const bytes: number[] = [];
    for (let i = 0; i < 4; i++) bytes.push((a[i] ?? 0) ^ (x[i] ?? 0));
    for (let i = 0; i < 4; i++) bytes.push((b[i] ?? 0) ^ (y[i] ?? 0));
    for (let i = 0; i < 4; i++) bytes.push((c[i] ?? 0) ^ (z[i] ?? 0));
    for (let i = 0; i < 4; i++) bytes.push((d[i] ?? 0) ^ (w[i] ?? 0));

    return String.fromCharCode(...bytes);
};

const toWordArray = (bytes: number[], length?: number): any => {
    const sigBytes = length ?? bytes.length;
    const words: number[] = [];
    for (let i = 0; i < sigBytes; i += 4) {
        words.push(
            ((((bytes[i] ?? 0) << 24) |
                ((bytes[i + 1] ?? 0) << 16) |
                ((bytes[i + 2] ?? 0) << 8) |
                (bytes[i + 3] ?? 0)) >>> 0),
        );
    }
    return CryptoJS.lib.WordArray.create(words, sigBytes);
};

const wordArrayToBytes = (wordArray: any): number[] => {
    const out: number[] = [];
    const sigBytes = wordArray.sigBytes;
    for (let i = 0; i < sigBytes; i++) {
        const word = wordArray.words[i >>> 2] ?? 0;
        out.push((word >>> (24 - (i % 4) * 8)) & 255);
    }
    return out;
};

const md5Bytes = (bytes: number[]): number[] => {
    const digest = CryptoJS.MD5(toWordArray(bytes)).toString(CryptoJS.enc.Hex);
    const out: number[] = [];
    for (let i = 0; i < digest.length; i += 2) {
        out.push(parseInt(digest.slice(i, i + 2), 16));
    }
    return out;
};

const deriveKeyAndIv = (password: string, salt: number[]): { key: number[]; iv: number[] } => {
    const passwordBytes = Array.from(password).map((ch) => ch.charCodeAt(0));
    const first = md5Bytes([...passwordBytes, ...salt]);
    const second = md5Bytes([...first, ...passwordBytes, ...salt]);
    const third = md5Bytes([...second, ...passwordBytes, ...salt]);
    return {
        key: [...first, ...second],
        iv: third,
    };
};

const decryptChapterPayloadData = (base64Ciphertext: string, passphrase: string): string => {
    const parsed = CryptoJS.enc.Base64.parse(base64Ciphertext);
    const allBytes = wordArrayToBytes(parsed);
    if (allBytes.length < 16) throw new Error('Encrypted payload is too short');

    const salt = allBytes.slice(8, 16);
    const encryptedBytes = allBytes.slice(16);
    const { key, iv } = deriveKeyAndIv(passphrase, salt);

    const decrypted = CryptoJS.AES.decrypt(
        { ciphertext: toWordArray(encryptedBytes, encryptedBytes.length) } as any,
        toWordArray(key, 32),
        {
            iv: toWordArray(iv, 16),
            mode: CryptoJS.mode.CBC,
            padding: CryptoJS.pad.Pkcs7,
        },
    );

    return decrypted.toString(CryptoJS.enc.Utf8);
};

const tryDecodePageKey = (encoded: string): number[] | undefined => {
    try {
        if (!/^H[1-9A-HJ-NP-Za-km-z]+$/.test(encoded)) return undefined;
        const body = encoded.slice(1, -1);
        const checksum = encoded.slice(-1);

        let value = 0;
        for (const ch of body) {
            const idx = BASE58_ALPHABET.indexOf(ch);
            if (idx < 0) return undefined;
            value = value * 58 + idx;
        }

        if (BASE58_ALPHABET[value % 58] !== checksum) return undefined;

        const pool = Array.from({ length: 10 }, (_, i) => i);
        const out: number[] = [];

        for (let i = 9; i >= 0; i--) {
            const f = FACTORIAL_TABLE[i] ?? 1;
            const pick = Math.floor(value / f);
            value = value % f;
            const item = pool.splice(pick, 1)[0];
            if (item === undefined) return undefined;
            out.push(item);
        }

        return out;
    } catch {
        return undefined;
    }
};

// ── Payload Processing ───────────────────────────────────────────────

const normalizeChapterPagesPayload = (payload: any): any => {
    let parsed = payload;

    if (payload?.encrypted === true && typeof payload?.data === 'string') {
        try {
            const decryptedText = decryptChapterPayloadData(payload.data, buildDecryptPassphrase());
            parsed = JSON.parse(decryptedText ?? '{}');
        } catch {
            parsed = payload;
        }
    }

    if (!parsed || typeof parsed !== 'object') return parsed;

    const pages = Array.isArray(parsed.pages)
        ? parsed.pages
        : (parsed.pages && typeof parsed.pages === 'object')
            ? Object.values(parsed.pages)
            : [];

    if (!pages.length) return parsed;

    const normalizedPages = pages.map((page: any) => {
        const decoded = typeof page?.key === 'string' ? tryDecodePageKey(page.key.replace(/^.{4}/, '')) : undefined;
        const cleanUrl = typeof page?.url === 'string' ? page.url.replace('_credit', '') : page?.url;

        return {
            ...page,
            url: cleanUrl,
            decoded,
        };
    });

    return {
        ...parsed,
        pages: normalizedPages,
    };
};

const toEntries = (value: any): any[] => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return Object.values(value);
    return [];
};

const payloadHasScrambleHints = (payload: any): boolean => {
    const pageEntries = toEntries(payload?.pages);
    for (const entry of pageEntries) {
        if (!entry || typeof entry !== 'object') continue;
        if (typeof entry.key === 'string' && entry.key.length > 0) return true;
        if (Array.isArray(entry.decoded) && entry.decoded.length > 0) return true;
    }
    return false;
};

const extractPagesFromPayload = (payload: any, preferUnscrambled: boolean): string[] => {
    const extractImageValue = (entry: any): string | undefined => {
        if (!entry) return undefined;
        if (typeof entry === 'string') return entry;
        if (typeof entry !== 'object') return undefined;

        // Try unscrambled/original URL fields first
        const rawCandidate =
            entry.originalUrl ??
            entry.originUrl ??
            entry.rawUrl ??
            entry.fullUrl ??
            entry.imageUrl ??
            entry.fileUrl ??
            entry.origin ??
            entry.original ??
            entry.raw ??
            entry?.page?.originalUrl ??
            entry?.page?.originUrl ??
            entry?.page?.rawUrl ??
            entry?.page?.original ??
            entry?.page?.origin;

        if (typeof rawCandidate === 'string' && rawCandidate.trim().length > 0) {
            return rawCandidate;
        }

        if (preferUnscrambled) {
            const imageCandidates = [
                entry?.images?.original,
                entry?.images?.raw,
                entry?.images?.full,
                entry?.image?.original,
                entry?.image?.raw,
                Array.isArray(entry?.images) ? entry.images[0] : undefined,
            ];

            for (const candidate of imageCandidates) {
                if (typeof candidate === 'string' && candidate.trim().length > 0) {
                    return candidate;
                }
            }
        }

        // Fall back to standard URL field
        const candidate =
            entry.url ??
            entry.image ??
            entry.src ??
            entry.path ??
            entry.file ??
            entry.link ??
            entry?.page?.url ??
            entry?.page?.image;

        return typeof candidate === 'string' ? candidate : undefined;
    };

    const candidateBuckets = [
        payload,
        payload?.pages,
        payload?.data,
        payload?.data?.pages,
        payload?.result,
        payload?.result?.pages,
        payload?.items,
        payload?.list,
    ];

    return candidateBuckets
        .flatMap((bucket) => toEntries(bucket))
        .map((entry: any) => extractImageValue(entry))
        .filter((value: string | undefined): value is string => !!value)
        .map((value: string) => normalizeImageUrl(value))
        .filter((value: string) => !!value);
};

// ── Query Helpers ────────────────────────────────────────────────────

const buildComicsQuery = (params: {
    page: number;
    limit: number;
    full?: boolean;
    search?: string;
    r18: string;
}): string => {
    const query = [
        `page=${params.page}`,
        `limit=${params.limit}`,
        `full=${params.full === false ? 'false' : 'true'}`,
        `r18=${params.r18}`,
        `allowR18=${params.r18}`,
    ];

    if (params.search) {
        query.push(`search=${encodeURIComponent(params.search)}`);
    }

    return query.join('&');
};

// ── Source Info ───────────────────────────────────────────────────────

export const YuriGardenInfo: SourceInfo = {
    version: '1.0.1',
    name: 'YuriGarden',
    icon: 'icon.png',
    author: 'AlanNois',
    authorWebsite: 'https://github.com/AlanNois',
    description: 'Extension that pulls manga from YuriGarden.',
    websiteBaseURL: DOMAIN,
    contentRating: ContentRating.MATURE,
    sourceTags: [
        {
            text: 'Recommended',
            type: BadgeColor.BLUE,
        },
    ],
    intents: SourceIntents.MANGA_CHAPTERS | SourceIntents.HOMEPAGE_SECTIONS | SourceIntents.CLOUDFLARE_BYPASS_REQUIRED | SourceIntents.SETTINGS_UI,
};

// ── Main Source Class ────────────────────────────────────────────────

export class YuriGarden implements ChapterProviding, MangaProviding, SearchResultsProviding, HomePageSectionsProviding {

    stateManager = App.createSourceStateManager();

    private async isR18Enabled(): Promise<boolean> {
        const value = await this.stateManager.retrieve('enable_r18');
        return value === true;
    }

    private async getR18QueryValue(): Promise<string> {
        return (await this.isR18Enabled()) ? 'true' : 'false';
    }

    private cloudflareError(status: number): void {
        if (status == 503 || status == 403) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to home page ${YuriGardenInfo.name} source and press the cloud icon.`);
        }
    }

    readonly requestManager = App.createRequestManager({
        requestsPerSecond: 4,
        requestTimeout: 35000,
        interceptor: {
            interceptRequest: async (request: Request): Promise<Request> => {
                request.headers = {
                    ...(request.headers ?? {}),
                    ...{
                        referer: DOMAIN,
                        origin: DOMAIN.replace(/\/$/, ''),
                        'x-app-origin': DOMAIN.replace(/\/$/, ''),
                        'x-custom-lang': 'vi',
                        accept: 'application/json, text/plain, */*',
                        'user-agent': await this.requestManager.getDefaultUserAgent(),
                    },
                };
                return request;
            },
            interceptResponse: async (response: Response): Promise<Response> => {
                return response;
            },
        },
    });

    getMangaShareUrl(mangaId: string): string {
        return `${DOMAIN}comic/${extractMangaId(mangaId)}`;
    }

    async getSourceMenu(): Promise<DUISection> {
        return App.createDUISection({
            id: 'main',
            header: 'YuriGarden Settings',
            rows: async () => [
                App.createDUISelect({
                    id: 'adult_content',
                    label: '18+ Content',
                    options: ['off', 'on'],
                    allowsMultiselect: false,
                    value: App.createDUIBinding({
                        get: async () => [(await this.isR18Enabled()) ? 'on' : 'off'],
                        set: async (value: string[]) => {
                            await this.stateManager.store('enable_r18', value[0] === 'on');
                        },
                    }),
                    labelResolver: async (option: string) => option === 'on' ? 'Show 18+ titles' : 'Hide 18+ titles',
                }),
            ],
            isHidden: false,
        });
    }

    private async getJSON<T>(url: string): Promise<T> {
        const request = App.createRequest({
            url,
            method: 'GET',
        });
        const response = await this.requestManager.schedule(request, 1);
        this.cloudflareError(response.status);

        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        // Also check for application-level 403 (body contains statusCode:403)
        if (data && typeof data === 'object' && (data.statusCode === 403 || data.message === 'Forbidden')) {
            throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to home page ${YuriGardenInfo.name} source and press the cloud icon.`);
        }

        return data as T;
    }

    async getCloudflareBypassRequestAsync(): Promise<Request> {
        // Must load a chapter reader page — this triggers the Cloudflare Turnstile
        // challenge that protects the api.yurigarden.com/api/chapters/pages/ endpoint.
        return App.createRequest({
            url: `${DOMAIN}comic/1170/9338`,
            method: 'GET',
            headers: {
                referer: DOMAIN,
                origin: DOMAIN.replace(/\/$/, ''),
                'user-agent': await this.requestManager.getDefaultUserAgent(),
            },
        });
    }

    private toPartialManga(comic: any): PartialSourceManga {
        return App.createPartialSourceManga({
            mangaId: String(comic.id),
            image: normalizeImageUrl(comic.thumbnail),
            title: String(comic.title ?? 'Unknown title'),
            subtitle: comic.latestChapter?.name
                ? `Chapter ${comic.latestChapter.order}${comic.latestChapter.name ? ` - ${comic.latestChapter.name}` : ''}`
                : undefined,
        });
    }

    async getSearchTags(): Promise<TagSection[]> {
        const systems = await this.getJSON<any>(`${API_DOMAIN}resources/systems_vi.json`);
        const genreSource = systems?.genres ?? {};

        const tags: Tag[] = Object.entries(genreSource).map(([key, value]) => {
            const label = typeof value === 'string'
                ? value
                : String((value as any)?.name ?? (value as any)?.label ?? key);
            return App.createTag({ id: key, label });
        });

        return [
            App.createTagSection({
                id: 'genres',
                label: 'Genres',
                tags,
            }),
        ];
    }

    async getMangaDetails(mangaId: string): Promise<SourceManga> {
        const id = extractMangaId(mangaId);
        const comic = await this.getJSON<any>(`${API_DOMAIN}api/comics/${id}`);

        const tags: Tag[] = (comic.genres ?? []).map((genre: string) => App.createTag({
            id: genre,
            label: genre,
        }));

        const desc = [
            comic.description,
            Array.isArray(comic.anotherNames) && comic.anotherNames.length > 0
                ? `Alternative names: ${comic.anotherNames.join(', ')}`
                : undefined,
        ].filter(Boolean).join('\n\n');

        return App.createSourceManga({
            id: String(comic.id),
            mangaInfo: App.createMangaInfo({
                titles: [String(comic.title ?? '')],
                image: normalizeImageUrl(comic.thumbnail),
                author: Array.isArray(comic.authors) ? comic.authors.map((x: any) => x?.name).filter(Boolean).join(', ') : '',
                artist: Array.isArray(comic.artists) ? comic.artists.map((x: any) => x?.name).filter(Boolean).join(', ') : '',
                desc,
                status: mapStatus(comic.status),
                tags: [App.createTagSection({ id: 'genres', label: 'Genres', tags })],
            }),
        });
    }

    async getChapters(mangaId: string): Promise<Chapter[]> {
        const id = extractMangaId(mangaId);
        const chapters = await this.getJSON<any[]>(`${API_DOMAIN}api/chapters/comic/${id}`);

        return [...chapters]
            .sort((a, b) => Number(a.order) - Number(b.order))
            .map((chapter) => {
                const order = Number(chapter.order ?? 0);
                const suffix = String(chapter.name ?? '').trim();
                const name = suffix ? `Chapter ${order} - ${suffix}` : `Chapter ${order}`;

                return App.createChapter({
                    id: String(chapter.id),
                    chapNum: order,
                    name,
                    langCode: '🇻🇳',
                    time: new Date(Number(chapter.publishedAt ?? chapter.lastUpdated ?? Date.now())),
                });
            });
    }

    async getChapterDetails(mangaId: string, chapterId: string): Promise<ChapterDetails> {
        const normalizedMangaId = extractMangaId(mangaId);
        const normalizedChapterId = extractChapterId(chapterId);

        const fetchPayload = async (useEdit: boolean): Promise<any> => {
            const request = App.createRequest({
                url: `${API_DOMAIN}api/chapters/pages/${normalizedChapterId}${useEdit ? '?edit=true' : ''}`,
                method: 'GET',
            });
            const response = await this.requestManager.schedule(request, 1);
            this.cloudflareError(response.status);

            const rawPayload = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
            return normalizeChapterPagesPayload(rawPayload);
        };

        // First try: normal fetch
        const payload = await fetchPayload(false);
        let pages = extractPagesFromPayload(payload, false);

        // If images are scrambled (R18 content), try the ?edit=true endpoint
        // which returns unscrambled original images
        if (payloadHasScrambleHints(payload)) {
            try {
                const editPayload = await fetchPayload(true);
                const editPages = extractPagesFromPayload(editPayload, true);
                if (editPages.length > 0) pages = editPages;
            } catch {
                // Keep default page URLs when edit endpoint is unavailable.
            }
        }

        if (!pages.length) {
            const statusCode = Number(payload?.statusCode ?? payload?.data?.statusCode ?? 0);
            const message = String(payload?.message ?? payload?.data?.message ?? '').trim();

            if (statusCode === 403 || /forbidden|verify|turnstile|password/i.test(message)) {
                throw new Error(`CLOUDFLARE BYPASS ERROR:\nPlease go to home page ${YuriGardenInfo.name} source and press the cloud icon.`);
            }

            throw new Error(`No pages found for this chapter`);
        }

        return App.createChapterDetails({
            id: normalizedChapterId,
            mangaId: normalizedMangaId,
            pages,
        });
    }

    async getSearchResults(query: SearchRequest, metadata: any): Promise<PagedResults> {
        const page = metadata?.page ?? 1;
        const limit = 12;
        const title = (query.title ?? '').trim();
        const r18 = await this.getR18QueryValue();

        const url = `${API_DOMAIN}api/comics?${buildComicsQuery({
            page,
            limit,
            full: true,
            search: title || undefined,
            r18,
        })}`;
        const payload = await this.getJSON<any>(url);

        const allResults: PartialSourceManga[] = (payload.comics ?? []).map((comic: any) => this.toPartialManga(comic));

        const selectedGenres = new Set((query.includedTags ?? []).map((tag) => tag.id));
        const results = selectedGenres.size
            ? allResults.filter((_, idx) => {
                const comic = payload.comics[idx];
                const genres: string[] = comic?.genres ?? [];
                for (const genre of genres) {
                    if (selectedGenres.has(genre)) return true;
                }
                return false;
            })
            : allResults;

        const nextMetadata = page < Number(payload.totalPages ?? 1) ? { page: page + 1 } : undefined;

        return App.createPagedResults({
            results,
            metadata: nextMetadata,
        });
    }

    async getHomePageSections(sectionCallback: (section: HomeSection) => void): Promise<void> {
        const r18 = await this.getR18QueryValue();
        const sections: HomeSection[] = [
            App.createHomeSection({ id: 'random', title: 'Ngẫu nhiên', containsMoreItems: false, type: HomeSectionType.singleRowNormal }),
            App.createHomeSection({ id: 'latest', title: 'Mới cập nhật', containsMoreItems: true, type: HomeSectionType.singleRowNormal }),
            App.createHomeSection({ id: 'trending', title: 'Xu hướng', containsMoreItems: false, type: HomeSectionType.singleRowNormal }),
        ];

        for (const section of sections) {
            sectionCallback(section);

            switch (section.id) {
                case 'random': {
                    const randomComics = await this.getJSON<any[]>(`${API_DOMAIN}api/comics/random?r18=${r18}&allowR18=${r18}`);
                    section.items = randomComics.map((comic) => this.toPartialManga(comic));
                    break;
                }
                case 'latest': {
                    const payload = await this.getJSON<any>(`${API_DOMAIN}api/comics?${buildComicsQuery({
                        page: 1,
                        limit: 12,
                        full: true,
                        r18,
                    })}`);
                    section.items = (payload.comics ?? []).map((comic: any) => this.toPartialManga(comic));
                    break;
                }
                case 'trending': {
                    const trending = await this.getJSON<any[]>(`${API_DOMAIN}api/comics/rank/trending?viewType=view&trendingType=day&r18=${r18}&allowR18=${r18}`);
                    section.items = trending.map((comic) => this.toPartialManga(comic));
                    break;
                }
            }

            sectionCallback(section);
        }
    }

    async getViewMoreItems(homepageSectionId: string, metadata: any): Promise<PagedResults> {
        if (homepageSectionId !== 'latest') {
            throw new Error('Requested to getViewMoreItems for a section ID which does not support pagination.');
        }

        const page = metadata?.page ?? 1;
        const limit = 12;
        const r18 = await this.getR18QueryValue();
        const payload = await this.getJSON<any>(`${API_DOMAIN}api/comics?${buildComicsQuery({
            page,
            limit,
            full: true,
            r18,
        })}`);

        const results = (payload.comics ?? []).map((comic: any) => this.toPartialManga(comic));
        const nextMetadata = page < Number(payload.totalPages ?? 1) ? { page: page + 1 } : undefined;

        return App.createPagedResults({
            results,
            metadata: nextMetadata,
        });
    }
}
