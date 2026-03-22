import {
    Chapter,
    SourceManga,
    Tag,
    TagSection,
    PartialSourceManga
} from '@paperback/types';

import { decryptPagesResponse } from './YuriGardenDecryptor';

const STORAGE_BASE = 'https://db.yurigarden.com/storage/v1/object/public/yuri-garden-store/';

export class Parser {

    /**
     * Resolves a thumbnail URL to a full URL.
     * Some thumbnails are already absolute URLs, others are relative paths.
     */
    private resolveThumbnailUrl(thumbnail: string): string {
        if (thumbnail.startsWith('http')) {
            return thumbnail;
        }
        return `${STORAGE_BASE}${thumbnail}`;
    }

    parseMangaDetails(json: any, mangaId: string): SourceManga {
        const tags: Tag[] = [];

        if (json.genres && Array.isArray(json.genres)) {
            for (const genre of json.genres) {
                if (!genre) continue;
                tags.push(App.createTag({ label: genre, id: genre }));
            }
        }

        const titles: string[] = [json.title];
        if (json.anotherNames && Array.isArray(json.anotherNames)) {
            for (const name of json.anotherNames) {
                if (name) titles.push(name);
            }
        }

        const author = json.authors?.map((a: any) => typeof a === 'string' ? a : a.name).join(', ') ?? '';
        const artist = json.artists?.map((a: any) => typeof a === 'string' ? a : a.name).join(', ') ?? '';
        const image = this.resolveThumbnailUrl(json.thumbnail ?? '');
        const desc = json.description ?? '';

        let status = 'Unknown';
        switch (json.status) {
            case 'ongoing':
                status = 'Ongoing';
                break;
            case 'completed':
                status = 'Completed';
                break;
            case 'oncoming':
                status = 'Oncoming';
                break;
        }

        return App.createSourceManga({
            id: mangaId,
            mangaInfo: App.createMangaInfo({
                titles,
                author,
                artist,
                image,
                desc,
                status,
                tags: [App.createTagSection({ id: '0', label: 'genres', tags })]
            })
        });
    }

    parseChapterList(json: any[]): Chapter[] {
        const chapters: Chapter[] = [];

        for (const obj of json) {
            const id = String(obj.id);
            const chapNum = parseFloat(String(obj.order));
            const name = obj.name || `Chap ${obj.order}`;
            const time = obj.lastUpdated ? new Date(obj.lastUpdated) : new Date(obj.publishedAt);
            const group = obj.team?.name ?? '';

            chapters.push(App.createChapter({
                id,
                chapNum,
                name,
                langCode: '🇻🇳',
                time,
                group,
            }));
        }

        if (chapters.length == 0) {
            throw new Error('No chapters found');
        }

        return chapters;
    }

    parseChapterDetails(json: any): string[] {
        const pages: string[] = [];

        // Handle API response formats:
        // 1. { encrypted: true, data: "<base64>" }  (AES-CBC encrypted)
        // 2. { pages: [{ id, url, key? }, ...], isLocked?, passwordHint? }
        // 3. { pages: ["url1", "url2", ...] }
        // 4. ["url1", "url2", ...]
        // 5. { statusCode: 403, message: "Forbidden" }  (Cloudflare block)

        if (json.statusCode === 403 || json.message === 'Forbidden') {
            return pages; // Empty - Cloudflare blocked
        }

        // Decrypt if encrypted
        let decrypted: any;
        try {
            decrypted = decryptPagesResponse(json);
        } catch (e) {
            // Decryption failed - try using raw data
            decrypted = json;
        }

        let pagesArray = Array.isArray(decrypted) ? decrypted : (decrypted.pages ?? []);

        if (!Array.isArray(pagesArray)) {
            return pages;
        }

        // If chapter is locked and no pages returned
        if (decrypted.isLocked && pagesArray.length === 0) {
            return pages;
        }

        for (const page of pagesArray) {
            let url = '';

            if (typeof page === 'string') {
                url = page;
            } else if (page && typeof page === 'object') {
                // After decryption, pages have: { id, url, decoded? }
                // where decoded is the permutation array for image strip reordering
                // NOTE: Paperback cannot descramble images (no Canvas API),
                // so we just use the URL as-is. Images may appear shuffled.
                url = page.url ?? '';
            }

            if (url) {
                pages.push(url.startsWith('http') ? url : `${STORAGE_BASE}${url}`);
            }
        }

        return pages;
    }

    parseSearchResults(json: any): PartialSourceManga[] {
        const comics: PartialSourceManga[] = [];

        if (!json.comics || !Array.isArray(json.comics)) {
            return comics;
        }

        for (const item of json.comics) {
            const mangaId = String(item.id);
            const title = item.title ?? '';
            const image = this.resolveThumbnailUrl(item.thumbnail ?? '');
            const subtitle = item.authors?.join(', ') ?? '';

            comics.push(App.createPartialSourceManga({
                mangaId,
                image,
                title,
                subtitle,
            }));
        }

        return comics;
    }

    parseTags(): TagSection[] {
        const genres: Tag[] = [
            { id: 'yuri', label: 'Yuri' },
            { id: 'romance', label: 'Romance' },
            { id: 'comedy', label: 'Comedy' },
            { id: 'slice-of-life', label: 'Slice of Life' },
            { id: 'school-life', label: 'School Life' },
            { id: 'ecchi', label: 'Ecchi' },
            { id: 'action', label: 'Action' },
            { id: 'drama', label: 'Drama' },
            { id: 'fantasy', label: 'Fantasy' },
            { id: 'sci-fi', label: 'Sci-Fi' },
            { id: 'gender-bender', label: 'Gender Bender' },
            { id: 'isekai', label: 'Isekai' },
        ];

        const status: Tag[] = [
            { id: 'status.ongoing', label: 'Đang tiến hành' },
            { id: 'status.completed', label: 'Đã hoàn thành' },
        ];

        return [
            App.createTagSection({ id: '0', label: 'Thể Loại', tags: genres.map(x => App.createTag(x)) }),
            App.createTagSection({ id: '1', label: 'Tình Trạng', tags: status.map(x => App.createTag(x)) }),
        ];
    }
}
