let toastSequence = 0;

export function useToast() {
  const toasts = useState("global-toasts", () => []);

  const dismiss = (id) => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  };

  const show = (message, options = {}) => {
    if (!message) return null;

    const id = `${Date.now()}-${toastSequence++}`;
    const toast = {
      id,
      message: String(message),
      type: options.type || "info",
      duration: Number.isFinite(options.duration) ? options.duration : 4000,
    };

    toasts.value = [...toasts.value, toast];

    if (import.meta.client && toast.duration > 0) {
      window.setTimeout(() => dismiss(id), toast.duration);
    }

    return id;
  };

  return {
    toasts,
    dismiss,
    show,
    success: (message, options = {}) =>
      show(message, { ...options, type: "success" }),
    error: (message, options = {}) =>
      show(message, { ...options, type: "error", duration: options.duration ?? 6000 }),
    info: (message, options = {}) =>
      show(message, { ...options, type: "info" }),
  };
}
