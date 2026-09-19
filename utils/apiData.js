export function asArray(payload, keys = []) {
  if (Array.isArray(payload)) return payload;

  for (const key of ["results", ...keys]) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  return [];
}

export function errorText(error, fallback = "Something went wrong") {
  return (
    error?.data?.error ||
    error?.data?.statusMessage ||
    error?.statusMessage ||
    error?.message ||
    fallback
  );
}
