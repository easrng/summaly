import { Buffer } from 'node:buffer';
import * as cheerio from 'cheerio';
import repo from '../../package.json' assert { type: 'json' };
import { StatusError } from './status-error.js';
import { detectEncoding, toUtf8 } from './encoding.js';
import type { ReadableStream, TransformStream as TransformStream_ } from 'node:stream/web';
let HTMLRewriter: typeof import('htmlrewriter').HTMLRewriter;
if ('Bun' in globalThis) {
	({ HTMLRewriter } = (await import('../../node_modules/htmlrewriter/node.mjs' as string)) as typeof import('htmlrewriter'));
} else {
	({ HTMLRewriter } = await import('htmlrewriter'));
}

declare const TransformStream: typeof TransformStream_;

export type GotOptions = {
	url: string;
	method: 'GET' | 'POST' | 'HEAD';
	body?: string;
	headers: Record<string, string | undefined>;
	typeFilter?: RegExp;
	responseTimeout?: number;
	operationTimeout?: number;
	contentLengthLimit?: number;
	contentLengthRequired?: boolean;
}

const DEFAULT_RESPONSE_TIMEOUT = 20 * 1000;
const DEFAULT_OPERATION_TIMEOUT = 60 * 1000;
const DEFAULT_MAX_RESPONSE_SIZE = 10 * 1024 * 1024;
const DEFAULT_BOT_UA = `SummalyBot/${repo.version}`;

export async function scpaping(
	url: string,
	opts?: {
		lang?: string;
		userAgent?: string;
		responseTimeout?: number;
		operationTimeout?: number;
		contentLengthLimit?: number;
		contentLengthRequired?: boolean;
	},
) {
	const args: Omit<GotOptions, 'method'> = {
		url,
		headers: {
			'accept': 'text/html,application/xhtml+xml',
			'user-agent': opts?.userAgent ?? DEFAULT_BOT_UA,
			'accept-language': opts?.lang,
		},
		typeFilter: /^(text\/html|application\/xhtml\+xml)/,
		responseTimeout: opts?.responseTimeout,
		operationTimeout: opts?.operationTimeout,
		contentLengthLimit: opts?.contentLengthLimit,
		contentLengthRequired: opts?.contentLengthRequired,
	};

	const response = await getResponse({
		...args,
		method: 'GET',
	});

	// We can't parse with HTMLRewriter because it doesn't properly support non-UTF-8
	// encodings, but we can use it to strip out tags we don't need since it won't
	// reencode text unless we ask it to.
	const rewriter = new HTMLRewriter();
	rewriter.on('*', {
		element(element) {
			const id = element.getAttribute('id');
			const tag = element.tagName;
			if (tag === 'script' || tag === 'template' || tag === 'style' || tag === 'svg') {
				element.remove();
			}
			if (tag !== 'title' && tag !== 'link' && tag !== 'meta' && id !== 'title' && id !== 'productDescription' && id !== 'landingImage') {
				element.removeAndKeepContent();
			}
		},
	});

	const bodyBuffer = Buffer.from(await rewriter.transform(response.body).arrayBuffer());
	const encoding = detectEncoding(bodyBuffer);
	const body = toUtf8(bodyBuffer, encoding);
	const $ = cheerio.load(body);

	return {
		body,
		$,
		response,
	};
}

export async function get(url: string) {
	const res = await getResponse({
		url,
		method: 'GET',
		headers: {
			'accept': '*/*',
		},
	});

	return await res.body.text();
}

export async function head(url: string) {
	return await getResponse({
		url,
		method: 'HEAD',
		headers: {
			'accept': '*/*',
		},
	});
}

async function getResponse(args: GotOptions): Promise<{ body: Response; response: Response; }> {
	const timeout = args.responseTimeout ?? DEFAULT_RESPONSE_TIMEOUT;
	const operationTimeout = args.operationTimeout ?? DEFAULT_OPERATION_TIMEOUT;

	const controller = new AbortController();
	const timeoutHandle = setTimeout(() => controller.abort(), timeout);
	const operationTimeoutHandle = setTimeout(() => controller.abort(), operationTimeout);
	try {
		const res = await fetch(args.url, {
			method: args.method,
			headers: Object.fromEntries(
				Object.entries(args.headers).filter<[string, string]>(
					(value): value is [string, string] => value[1] !== undefined,
				),
			),
			body: args.body,
			signal: controller.signal,
		});

		clearTimeout(timeoutHandle);

		if (!res.ok) {
			// 応答取得 with ステータスコードエラーの整形
			throw new StatusError(`${res.status} ${res.statusText}`, res.status, res.statusText);
		}

		// Check html
		const contentType = res.headers.get('content-type');
		if (args.typeFilter && !contentType?.match(args.typeFilter)) {
			throw new Error(`Rejected by type filter ${contentType}`);
		}

		// 応答ヘッダでサイズチェック
		const contentLength = res.headers.get('content-length');
		if (contentLength) {
			const maxSize = args.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE;
			const size = Number(contentLength);
			if (size > maxSize) {
				throw new Error(`maxSize exceeded (${size} > ${maxSize}) on response`);
			}
		} else {
			if (args.contentLengthRequired) {
				throw new Error('content-length required');
			}
		}

		const maxSize = args.contentLengthLimit ?? DEFAULT_MAX_RESPONSE_SIZE;

		// 受信中のデータでサイズチェック
		let transferred = 0;

		let bodyStream: ReadableStream<Uint8Array> | undefined;
		if (res.body) {
			bodyStream = res.body.pipeThrough(new TransformStream({
				start() {
				},
				transform(chunk, controller) {
					transferred += chunk.length;
					if (transferred > maxSize ) {
						throw new Error(`maxSize exceeded (${transferred} > ${maxSize}) on response`);
					}
					controller.enqueue(chunk);
				},
				flush() {
				},
			}));
		}

		const body = new Response(bodyStream, {
			headers: res.headers,
		});
		
		clearTimeout(operationTimeoutHandle);
	
		return {
			body,
			response: res,
		};
	} catch (e) {
		clearTimeout(timeoutHandle);
		clearTimeout(operationTimeoutHandle);
		controller.abort();
		throw e;
	}
}
