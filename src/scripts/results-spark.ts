// DOM lifecycle for Story 1.10's one-shot results-bar spark. Callers stage
// every affected fill first, perform their full reconcile, flush once, then
// invoke the returned starter so all sparks share the same style epoch.

const SPARK_CLASS = "is-spark";
const SPARK_ANIMATION = "results-bar-spark";
const activeFinishers = new WeakMap<
  HTMLElement,
  (event: AnimationEvent) => void
>();

const clearSpark = (fill: HTMLElement): void => {
  const finisher = activeFinishers.get(fill);
  if (finisher) {
    fill.removeEventListener("animationend", finisher);
    activeFinishers.delete(fill);
  }
  fill.classList.remove(SPARK_CLASS);
};

export function prepareResultsSparks(
  fills: Iterable<HTMLElement>,
): () => void {
  const uniqueFills = [...new Set(fills)];
  for (const fill of uniqueFills) {
    clearSpark(fill);
  }
  return () => {
    for (const fill of uniqueFills) {
      const finish = (event: AnimationEvent): void => {
        if (event.target !== fill || event.animationName !== SPARK_ANIMATION) {
          return;
        }
        fill.removeEventListener("animationend", finish);
        activeFinishers.delete(fill);
        fill.classList.remove(SPARK_CLASS);
      };
      activeFinishers.set(fill, finish);
      fill.addEventListener("animationend", finish);
      fill.classList.add(SPARK_CLASS);
    }
  };
}

export function clearResultsSparks(root: HTMLElement): void {
  for (const fill of root.querySelectorAll<HTMLElement>(
    `.results-bar-fill.${SPARK_CLASS}`,
  )) {
    clearSpark(fill);
  }
}
