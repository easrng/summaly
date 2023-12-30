/**
 * summaly
 * https://github.com/misskey-dev/summaly
 */

import { URL } from 'node:url';
import tracer from 'trace-redirect';
import * as Got from 'got';
import { SummalyResult } from './summary.js';
import { SummalyPlugin } from './iplugin.js';
export * from './iplugin.js';
import general from './general.js';
import { setAgent } from './utils/got.js';
import { plugins as builtinPlugins } from './plugins/index.js';
import type { FastifyInstance } from 'fastify';

export type SummalyOptions = {
	/**
	 * Accept-Language for the request
	 */
	lang?: string | null;

	/**
	 * Whether follow redirects
	 */
	followRedirects?: boolean;

	/**
	 * Custom Plugins
	 */
	plugins?: SummalyPlugin[];

	/**
	 * Custom HTTP agent
	 */
	agent?: Got.Agents;
};

export const summalyDefaultOptions = {
	lang: null,
	followRedirects: true,
	plugins: [],
} as SummalyOptions;

/**
 * Summarize an web page
 */
export const summaly = async (url: string, options?: SummalyOptions): Promise<SummalyResult> => {
	if (options?.agent) setAgent(options.agent);

	const opts = Object.assign(summalyDefaultOptions, options);

	const plugins = builtinPlugins.concat(opts.plugins || []);

	let actualUrl = url;
	if (opts.followRedirects) {
		// .catch(() => url)にすればいいけど、jestにtrace-redirectを食わせるのが面倒なのでtry-catch
		try {
			actualUrl = await tracer(url);
		} catch (e) {
			actualUrl = url;
		}
	}

	const _url = new URL(actualUrl);

	// Find matching plugin
	const match = plugins.filter(plugin => plugin.test(_url))[0];

	// Get summary
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	const summary = await (match ? match.summarize : general)(_url, opts.lang || undefined);

	if (summary == null) {
		throw new Error('failed summarize');
	}

	return Object.assign(summary, {
		url: actualUrl,
	});
};

export default function (fastify: FastifyInstance, options: SummalyOptions, done: (err?: Error) => void) {
	fastify.get<{
        Querystring: {
				url?: string;
				lang?: string;
			};
	}>('/', async (req, reply) => {
		const url = req.query.url as string;
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
		if (url == null) {
			return reply.status(400).send({
				error: 'url is required',
			});
		}

		try {
			const summary = await summaly(url, {
				lang: req.query.lang as string,
				followRedirects: false,
				...options,
			});

			return summary;
		} catch (e) {
			return reply.status(500).send({
				error: e,
			});
		}
	});

	done();
}
