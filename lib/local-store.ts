"use client";
import type { Review } from "./types";

/** Personal notes, agree/my-take and your own picks live in this browser only. */
const KEY = "jango-playz:reviews:v2";

export function loadReviews(): Record<string, Review> {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, Review>) : {};
  } catch {
    return {};
  }
}
export function saveReviews(reviews: Record<string, Review>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(reviews));
    return true;
  } catch {
    return false;
  }
}
