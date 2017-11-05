/**
 * Interface for objects to perform actions if they are not needed anymore
 */
export interface Disposable {
    /**
     * Disposes the object. Example actions:
     *  - Cancelling all pending operations this object started
     *  - Unsubscribing all listeners this object added
     */
    dispose(): void
}
