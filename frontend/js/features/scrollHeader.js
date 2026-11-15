// Direction-aware visibility for the shared site masthead.
// Pure state machine: only explicit scrolling changes visibility.
export function createHeaderScrollController({
  topThreshold = 72, hideDistance = 28, showDistance = 18
} = {}) {
  let lastY = 0;
  let direction = 0;
  let travelled = 0;
  let hidden = false;

  const readY = (value) => Math.max(0, Number.isFinite(value) ? value : 0);

  return {
    reset(scrollY = 0) {
      lastY = readY(scrollY);
      direction = 0;
      travelled = 0;
      hidden = false;
      return hidden;
    },
    reveal() {
      direction = 0;
      travelled = 0;
      hidden = false;
      return hidden;
    },
    update(scrollY, { keepVisible = false } = {}) {
      const y = readY(scrollY);
      const delta = y - lastY;
      lastY = y;
      if (keepVisible || y <= topThreshold) return this.reveal();
      const nextDirection = Math.sign(delta);
      if (!nextDirection) return hidden;
      if (nextDirection !== direction) {
        direction = nextDirection;
        travelled = 0;
      }
      travelled += Math.abs(delta);
      if (direction > 0 && travelled >= hideDistance) hidden = true;
      else if (direction < 0 && travelled >= showDistance) hidden = false;
      return hidden;
    }
  };
}
