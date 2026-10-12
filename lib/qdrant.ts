import './env.js';
import { QdrantClient } from '@qdrant/js-client-rest';

// ONE place that configures how we talk to Qdrant, same idea as lib/openai.ts.
export const qdrant = new QdrantClient({
	url: process.env.QDRANT_CLUSTER_ENDPOINT,
	apiKey: process.env.QDRANT_API_KEY,
});

export const BIBLE_COLLECTION = 'bible';
