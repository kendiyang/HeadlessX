'use client';

import { MarketplaceInspectWorkbench } from '../commerce/MarketplaceInspectWorkbench';

interface WalmartWorkbenchProps {
    available: boolean;
    unavailableReason?: string | null;
}

export function WalmartWorkbench({ available, unavailableReason }: WalmartWorkbenchProps) {
    return (
        <MarketplaceInspectWorkbench
            operatorLabel="Walmart"
            description="Inspect product metadata, pricing, seller, availability, and review data for catalog monitoring."
            endpoint="/api/operators/walmart/inspect"
            inputPlaceholder="https://www.walmart.com/ip/... or 123456789"
            marketplacePlaceholder="walmart.com or ca (optional)"
            loadingLabel="Crawling product data"
            idStatLabel="Product ID"
            available={available}
            unavailableReason={unavailableReason}
            supportsReviews
            reviewPageLimitMax={5000}
            showMarketplaceInput={false}
            showWaitForSelectorInput={false}
            showTimeoutInput={false}
        />
    );
}
