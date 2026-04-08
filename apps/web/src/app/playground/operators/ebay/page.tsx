import { EbayWorkbench } from '@/components/playground/ebay';
import { getEbayAvailabilityState } from '@/lib/playgroundAvailability';

export default async function EbayOperatorPage() {
    const availability = await getEbayAvailabilityState();

    return (
        <EbayWorkbench
            available={availability.available}
            unavailableReason={availability.reason}
        />
    );
}
