import { type Signal } from '../../../core/signal.js';
export interface ListItemMetadataSignals {
    $index: Signal<number>;
    $count: Signal<number>;
    $first: Signal<boolean>;
    $last: Signal<boolean>;
    $odd: Signal<boolean>;
    $even: Signal<boolean>;
}
export declare function createListItemMetadata(index: number, count: number): ListItemMetadataSignals;
export declare function updateListItemMetadata(metadata: ListItemMetadataSignals | undefined, index: number, count: number): void;
