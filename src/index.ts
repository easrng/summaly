/**
 * summaly
 * https://github.com/misskey-dev/summaly
 */

import { head } from './utils/got.js';
import { SummalyResult } from './summary.js';
import { SummalyPlugin } from './iplugin.js';
export * from './iplugin.js';
import general, { GeneralScrapingOptions } from './general.js';
import { plugins as builtinPlugins } from './plugins/index.js';
import type { FastifyInstance } from 'fastify';

export type SummalyOptions = {
	/**
	 * Accept-Language for the request
	 */
	lang?: string | null;

	/**
	 * Whether to match plugins on redirected URLs
	 */
	followRedirects?: boolean;

	/**
	 * Custom Plugins
	 */
	plugins?: SummalyPlugin[];

	/**
	 * User-Agent for the request
	 */
	userAgent?: string;

	/**
	 * Response timeout.
	 * Set timeouts for each phase, such as host name resolution and socket communication.
	 */
	responseTimeout?: number;

	/**
	 * Operation timeout.
	 * Set the timeout from the start to the end of the request.
	 */
	operationTimeout?: number;

	/**
	 * Maximum content length.
	 * If set to true, an error will occur if the content-length value returned from the other server is larger than this parameter (or if the received body size exceeds this parameter).
	 */
	contentLengthLimit?: number;

	/**
	 * Content length required.
	 * If set to true, it will be an error if the other server does not return content-length.
	 */
	contentLengthRequired?: boolean;
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
	const opts = Object.assign(summalyDefaultOptions, options);

	const plugins = builtinPlugins.concat(opts.plugins || []);

	let actualUrl = url;
	if (opts.followRedirects) {
		try {
			actualUrl = (await head(url)).response.url;
		} catch (e) {
			actualUrl = url;
		}
	}

	const _url = new URL(actualUrl);

	// Find matching plugin
	const firstURL = new URL(url);
	const firstMatch = plugins.filter(plugin => plugin.test(firstURL))[0];
	const finalMatch = firstURL.href !== _url.href && plugins.filter(plugin => plugin.test(_url))[0];

	// Get summary
	const scrapingOptions: GeneralScrapingOptions = {
		lang: opts.lang,
		userAgent: opts.userAgent,
		responseTimeout: opts.responseTimeout,
		operationTimeout: opts.operationTimeout,
		contentLengthLimit: opts.contentLengthLimit,
		contentLengthRequired: opts.contentLengthRequired,
	};

	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	const summary = await (firstMatch ? firstMatch.summarize : finalMatch ? finalMatch.summarize : general)(_url, scrapingOptions);

	if (summary == null) {
		throw new Error('failed summarize');
	}

	return Object.assign(summary, {
		url: firstURL.href,
	});
};

export const fastify = function (fastify: FastifyInstance, options: SummalyOptions, done: (err?: Error) => void) {
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
};

export const fetch = async function(req: Request): Promise<Response> {
	const query = new URL(req.url).searchParams;
	const url = query.get('url');
	if (url == null) {
		return Response.json({
			error: 'url is required',
		}, {
			status: 400,
		});
	}
  
	try {
		const summary = await summaly(url, {
			lang: query.get('lang'),
		});
  
		return Response.json(summary);
	} catch (e) {
		console.error(e);
		return Response.json({
			error: e,
		}, {
			status: 500,
		});
	}
};

const fastifetch: typeof fastify & { fetch: typeof fetch } = Object.assign((
	fastify_: FastifyInstance,
	options: SummalyOptions,
	done: (err?: Error) => void,
) => fastify(fastify_, options, done), {
	fetch,
});

export default fastifetch;
