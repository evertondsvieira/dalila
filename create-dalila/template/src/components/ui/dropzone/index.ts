import { signal } from "../../../core/signal.js";
import { getCurrentScope } from "../../../core/scope.js";
import type { Dropzone, DropzoneOptions } from "../ui-types.js";
import { validateDropzoneOptions } from "../validate.js";

export function createDropzone(options: DropzoneOptions = {}): Dropzone {
  validateDropzoneOptions(options as Record<string, unknown>);
  const { accept, multiple = true, maxFiles, maxSize } = options;

  const dragging = signal(false);
  const files = signal<File[]>([]);

  let inputEl: HTMLInputElement | null = null;

  const filterFiles = (fileList: File[]): File[] => {
    let result = fileList;

    if (accept) {
      const types = accept.split(",").map((t) => t.trim().toLowerCase());
      result = result.filter((f) => {
        const ext = "." + f.name.split(".").pop()?.toLowerCase();
        const mime = f.type.toLowerCase();
        return types.some(
          (t) => t === ext || t === mime || (t.endsWith("/*") && mime.startsWith(t.slice(0, -1)))
        );
      });
    }

    if (maxSize) {
      result = result.filter((f) => f.size <= maxSize);
    }

    if (maxFiles) {
      result = result.slice(0, maxFiles);
    }

    return result;
  };

  const addFiles = (newFiles: File[]) => {
    const filtered = filterFiles(newFiles);
    if (multiple) {
      files.update((current) => {
        const combined = [...current, ...filtered];
        return maxFiles ? combined.slice(0, maxFiles) : combined;
      });
    } else {
      files.set(filtered.slice(0, 1));
    }
  };

  const browse = () => {
    inputEl?.click();
  };

  const handleClick = () => browse();

  const handleDragover = (ev: DragEvent) => {
    ev.preventDefault();
    dragging.set(true);
  };

  const handleDragleave = () => {
    dragging.set(false);
  };

  const handleDrop = (ev: DragEvent) => {
    ev.preventDefault();
    dragging.set(false);
    if (ev.dataTransfer?.files) {
      addFiles(Array.from(ev.dataTransfer.files));
    }
  };

  const _attachTo = (el: HTMLElement) => {
    const scope = getCurrentScope();

    // ARIA
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");

    inputEl = el.querySelector<HTMLInputElement>('input[type="file"]');

    if (inputEl) {
      if (accept) inputEl.accept = accept;
      inputEl.multiple = multiple;

      const onInputChange = () => {
        if (inputEl?.files) {
          addFiles(Array.from(inputEl.files));
          inputEl.value = "";
        }
      };
      inputEl.addEventListener("change", onInputChange);

      if (scope) {
        scope.onCleanup(() => {
          inputEl?.removeEventListener("change", onInputChange);
        });
      }
    }
  };

  return {
    dragging,
    files,
    browse,
    handleClick,
    handleDragover,
    handleDragleave,
    handleDrop,
    _attachTo,
  };
}
