import { signal } from '../../../core/signal.js';
export function createListItemMetadata(index, count) {
    return {
        $index: signal(index),
        $count: signal(count),
        $first: signal(index === 0),
        $last: signal(index === count - 1),
        $odd: signal(index % 2 !== 0),
        $even: signal(index % 2 === 0),
    };
}
export function updateListItemMetadata(metadata, index, count) {
    if (!metadata)
        return;
    metadata.$index.set(index);
    metadata.$count.set(count);
    metadata.$first.set(index === 0);
    metadata.$last.set(index === count - 1);
    metadata.$odd.set(index % 2 !== 0);
    metadata.$even.set(index % 2 === 0);
}
