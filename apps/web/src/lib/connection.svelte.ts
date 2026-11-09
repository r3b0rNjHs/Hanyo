export const connection = $state({ online: typeof navigator === "undefined" ? true : navigator.onLine });
