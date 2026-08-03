export function createCustomHTMLOverlay(
  position: google.maps.LatLng,
  content: HTMLElement,
  onClick?: () => void
) {
  class CustomHTMLOverlay extends google.maps.OverlayView {
    private position: google.maps.LatLng;
    private content: HTMLElement;
    private container: HTMLDivElement | null = null;
    private onClickHandler?: () => void;

    constructor(
      position: google.maps.LatLng,
      content: HTMLElement,
      onClick?: () => void
    ) {
      super();
      this.position = position;
      this.content = content;
      this.onClickHandler = onClick;
    }

    onAdd(): void {
      this.container = document.createElement("div");
      this.container.style.position = "absolute";
      this.container.style.transform = "translate(-50%, -100%)"; // Center anchor horizontally, bottom anchor vertically
      this.container.style.cursor = "pointer";
      this.container.style.zIndex = "10";
      this.container.style.willChange = "left, top";

      this.container.appendChild(this.content);

      if (this.onClickHandler) {
        this.container.addEventListener("click", (e) => {
          e.stopPropagation();
          this.onClickHandler?.();
        });
        
        this.container.addEventListener("touchend", (e) => {
          e.stopPropagation();
          this.onClickHandler?.();
        });
      }

      const panes = this.getPanes();
      if (panes) {
        panes.overlayMouseTarget.appendChild(this.container);
      }
    }

    draw(): void {
      if (!this.container) return;

      const projection = this.getProjection();
      if (!projection) return;

      const positionPixels = projection.fromLatLngToDivPixel(this.position);
      if (positionPixels) {
        this.container.style.left = `${positionPixels.x}px`;
        this.container.style.top = `${positionPixels.y}px`;
      }
    }

    onRemove(): void {
      if (this.container) {
        this.container.parentNode?.removeChild(this.container);
        this.container = null;
      }
    }

    getPosition(): google.maps.LatLng {
      return this.position;
    }
  }

  return new CustomHTMLOverlay(position, content, onClick);
}
export type CustomHTMLOverlayInstance = any;
