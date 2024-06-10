import Summary from './summary.js';
import { GeneralScrapingOptions } from '@/general';

export interface SummalyPlugin {
	test: (url: URL) => boolean;
	summarize: (url: URL, opts?: GeneralScrapingOptions) => Promise<Summary | null>;
}
