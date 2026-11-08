/**
 * Loads and trains the recommender from the CSVs, so a bad catalogue fails the build
 * instead of the first request. Runs before `next build` (see "prebuild" in package.json).
 */
import { resolve } from "node:path";
import { loadRecommender } from "../src/lib/recommender/server";

loadRecommender(resolve(import.meta.dirname, ".."));
console.log("Catalogue, leads and price sensitivity CSVs load cleanly.");
