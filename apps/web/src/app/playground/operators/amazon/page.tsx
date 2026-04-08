import { AmazonWorkbench } from '@/components/playground/amazon';
import { getAmazonAvailabilityState } from '@/lib/playgroundAvailability';

export default async function AmazonOperatorPage() {
    const availability = await getAmazonAvailabilityState();

    return (
        <AmazonWorkbench
            available={availability.available}
            unavailableReason={availability.reason}
        />
    );
}
