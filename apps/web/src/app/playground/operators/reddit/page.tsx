import { RedditWorkbench } from '@/components/playground/reddit';
import { getRedditAvailabilityState } from '@/lib/playgroundAvailability';

export default async function RedditOperatorPage() {
    const availability = await getRedditAvailabilityState();

    return (
        <RedditWorkbench
            available={availability.available}
            unavailableReason={availability.reason}
        />
    );
}
