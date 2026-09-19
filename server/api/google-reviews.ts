import { useRuntimeConfig } from "#imports";
import { createError, defineEventHandler } from "h3";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const apiKey = String(
    process.env.NUXT_GOOGLE_PLACES_API_KEY || config.googlePlacesApiKey || "",
  ).trim();
  const placeId = String(
    process.env.NUXT_GOOGLE_PLACES_PLACE_ID || config.googlePlacesPlaceId || "",
  ).trim();

  if (!apiKey || !placeId) {
    throw createError({
      statusCode: 503,
      statusMessage: "Google Places reviews are not configured.",
    });
  }

  const params = new URLSearchParams({
    place_id: placeId,
    fields: "name,rating,reviews",
    key: apiKey,
  });

  try {
    const response: any = await $fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
      { timeout: 10_000, retry: 0 },
    );

    if (response.status !== "OK" || !Array.isArray(response.result?.reviews)) {
      console.error(
        "Google Places API error:",
        response.error_message || response.status,
      );
      return [];
    }

    return response.result.reviews.map((review: any) => ({
      name: review.author_name,
      stars: review.rating,
      content: review.text,
      time_ago: review.relative_time_description,
    }));
  } catch (error) {
    console.error("Failed to fetch Google reviews:", error);
    throw createError({
      statusCode: 502,
      statusMessage: "Failed to fetch Google reviews.",
    });
  }
});
