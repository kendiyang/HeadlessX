import { asMarkdownCodeBlock } from './responses';

export function websiteHtmlMarkdown(data: {
    url: string;
    title: string;
    statusCode: number;
    metadata?: Record<string, unknown>;
    html: string;
}) {
    return [
        '# Website HTML',
        '',
        `**URL:** ${data.url}`,
        `**Title:** ${data.title || 'Untitled'}`,
        `**Status Code:** ${data.statusCode}`,
        '',
        '## Metadata',
        '',
        asMarkdownCodeBlock(data.metadata || {}),
        '',
        '## HTML',
        '',
        '```html',
        data.html,
        '```',
    ].join('\n');
}

export function websiteMarkdownResult(data: {
    url: string;
    title: string;
    metadata?: Record<string, unknown>;
    markdown: string;
}) {
    return [
        '# Website Markdown',
        '',
        `**URL:** ${data.url}`,
        `**Title:** ${data.title || 'Untitled'}`,
        '',
        '## Metadata',
        '',
        asMarkdownCodeBlock(data.metadata || {}),
        '',
        '## Content',
        '',
        data.markdown || '_No markdown content returned._',
    ].join('\n');
}

export function websiteMapMarkdown(data: {
    url: string;
    title: string;
    summary: unknown;
    links: Array<{ url: string; title?: string; source?: string }>;
}) {
    const lines = [
        '# Website Map',
        '',
        `**URL:** ${data.url}`,
        `**Title:** ${data.title || 'Untitled'}`,
        '',
        '## Summary',
        '',
        asMarkdownCodeBlock(data.summary),
        '',
        '## Links',
        '',
    ];

    if (!data.links.length) {
        lines.push('_No links found._');
        return lines.join('\n');
    }

    data.links.forEach((link, index) => {
        lines.push(`${index + 1}. [${link.title || link.url}](${link.url})`);
    });

    return lines.join('\n');
}

export function jsonTitleMarkdown(title: string, data: unknown) {
    return `# ${title}\n\n${asMarkdownCodeBlock(data)}`;
}

type AmazonInspectMarkdownShape = {
    title?: string | null;
    url?: string | null;
    asin?: string | null;
    brand?: string | null;
    price?: {
        value?: number | null;
        currency?: string | null;
    } | null;
    reviewsCount?: number | null;
    features?: string[] | null;
    seller?: {
        name?: string | null;
        id?: string | null;
        url?: string | null;
    } | null;
    reviews?: unknown[] | null;
};

export function amazonInspectMarkdown(input: unknown) {
    const data = (input || {}) as AmazonInspectMarkdownShape;
    const title = data.title || 'Untitled product';
    const url = data.url || 'n/a';
    const asin = data.asin || 'n/a';
    const brand = data.brand || 'n/a';
    const priceText =
        data.price?.value !== null && data.price?.value !== undefined
            ? `${data.price?.currency || ''}${data.price.value}`
            : 'n/a';
    const reviewsCount =
        typeof data.reviewsCount === 'number'
            ? data.reviewsCount.toLocaleString()
            : 'n/a';
    const reviewCollected = Array.isArray(data.reviews) ? data.reviews.length : 0;

    const lines = [
        '# Amazon Inspect',
        '',
        `**Title:** ${title}`,
        `**URL:** ${url}`,
        `**ASIN:** ${asin}`,
        `**Brand:** ${brand}`,
        `**Price:** ${priceText}`,
        `**Reviews Count:** ${reviewsCount}`,
        `**Reviews Returned:** ${reviewCollected}`,
        `**Seller:** ${data.seller?.name || 'n/a'} (${data.seller?.id || 'n/a'})`,
    ];

    if (Array.isArray(data.features) && data.features.length > 0) {
        lines.push('');
        lines.push('## Features');
        lines.push('');
        for (const feature of data.features.slice(0, 8)) {
            lines.push(`- ${feature}`);
        }
        if (data.features.length > 8) {
            lines.push(`- ...and ${data.features.length - 8} more`);
        }
    }

    lines.push('');
    lines.push('## Full Payload');
    lines.push('');
    lines.push(asMarkdownCodeBlock(data));

    return lines.join('\n');
}
