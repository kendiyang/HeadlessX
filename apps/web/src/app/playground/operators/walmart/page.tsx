import { WalmartWorkbench } from '@/components/playground/walmart';
import { getWalmartAvailabilityState } from '@/lib/playgroundAvailability';

export default async function WalmartOperatorPage() {
    const availability = await getWalmartAvailabilityState();

    return (
        <WalmartWorkbench
            available={availability.available}
            unavailableReason={availability.reason}
        />
    );
}
