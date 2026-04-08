'use client';

import { MarketplaceInspectWorkbench } from '../commerce/MarketplaceInspectWorkbench';

interface EbayWorkbenchProps {
    available: boolean;
    unavailableReason?: string | null;
}

export function EbayWorkbench({ available, unavailableReason }: EbayWorkbenchProps) {
    return (
        <MarketplaceInspectWorkbench
            operatorLabel="eBay"
            description="Inspect listing metadata, pricing, seller, and availability data for marketplace intelligence."
            endpoint="/api/operators/ebay/inspect"
            inputPlaceholder="https://www.ebay.com/itm/... or 123456789012"
            marketplacePlaceholder="ebay.com or co.uk (optional)"
            loadingLabel="Crawling listing data"
            idStatLabel="Item ID"
            available={available}
            unavailableReason={unavailableReason}
        />
    );
}
