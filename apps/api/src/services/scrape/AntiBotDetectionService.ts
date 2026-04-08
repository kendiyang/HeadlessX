export type AntiBotProvider = 'amazon' | 'ebay' | 'walmart';

export interface AntiBotDetectionResult {
    provider: AntiBotProvider;
    blocked: boolean;
    matchedSignals: string[];
}

interface AntiBotRuleSet {
    urlSignals: string[];
    htmlSignals: string[];
}

const AMAZON_RULES: AntiBotRuleSet = {
    urlSignals: [
        '/errors/validatecaptcha',
        '/error/500',
    ],
    htmlSignals: [
        'sorry, we just need to make sure you\'re not a robot',
        'enter the characters you see below',
        '/errors/validatecaptcha',
        'to discuss automated access to amazon data',
        'api-services-support@amazon.com',
    ],
};

const EBAY_RULES: AntiBotRuleSet = {
    urlSignals: [
        '/captcha',
        '/signin/suspended',
    ],
    htmlSignals: [
        'pardon our interruption',
        'to make sure this is really you',
        'please verify yourself',
    ],
};

const WALMART_RULES: AntiBotRuleSet = {
    urlSignals: [
        '/blocked',
        '/captcha',
    ],
    htmlSignals: [
        'are you a robot',
        'please verify you are a human',
        'access to this page has been denied',
        'enter the characters you see below',
    ],
};

const RULES_BY_PROVIDER: Record<AntiBotProvider, AntiBotRuleSet> = {
    amazon: AMAZON_RULES,
    ebay: EBAY_RULES,
    walmart: WALMART_RULES,
};

class AntiBotDetectionService {
    private static instance: AntiBotDetectionService;

    public static getInstance(): AntiBotDetectionService {
        if (!AntiBotDetectionService.instance) {
            AntiBotDetectionService.instance = new AntiBotDetectionService();
        }
        return AntiBotDetectionService.instance;
    }

    public detect(provider: AntiBotProvider, url: string, html: string): AntiBotDetectionResult {
        const rules = RULES_BY_PROVIDER[provider];
        const normalizedUrl = url.toLowerCase();
        const loweredHtml = html.toLowerCase();

        const matchedUrlSignals = rules.urlSignals.filter((signal) => normalizedUrl.includes(signal));
        const matchedHtmlSignals = rules.htmlSignals.filter((signal) => loweredHtml.includes(signal));
        const matchedSignals = [
            ...matchedUrlSignals.map((signal) => `url:${signal}`),
            ...matchedHtmlSignals.map((signal) => `html:${signal}`),
        ];

        return {
            provider,
            blocked: matchedSignals.length > 0,
            matchedSignals,
        };
    }

    public isBlocked(provider: AntiBotProvider, url: string, html: string): boolean {
        return this.detect(provider, url, html).blocked;
    }
}

export const antiBotDetectionService = AntiBotDetectionService.getInstance();
