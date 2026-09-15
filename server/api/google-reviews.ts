import { createError, defineEventHandler } from "h3";
import { useRuntimeConfig } from "#imports";

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const apiKey = String(config.googlePlacesApiKey || "");
  const placeId = String(config.googlePlacesPlaceId || "");

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
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`
    );

    if (response.status !== "OK" || !response.result?.reviews) {
      console.error(
        "Google Places API error:",
        response.error_message || response.status
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
