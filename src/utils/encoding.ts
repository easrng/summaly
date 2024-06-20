import iconv from 'iconv-lite';
import jschardet from 'jschardet';

export function detectEncoding(body: Buffer) {
	const detected = jschardet.detect(body, { minimumThreshold: 0.99 });
	// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
	if (detected) {
		const candicate = detected.encoding;
		const encoding = toEncoding(candicate);
		if (encoding != null) return encoding;
	}
	return;
}

export function toUtf8(body: Buffer, encoding: string): string {
	return iconv.decode(body, encoding);
}

export function toEncoding(candicate: string | null | undefined): string | null {
	if (!candicate) {
		return null;
	} else if (iconv.encodingExists(candicate)) {
		if (['shift_jis', 'shift-jis', 'windows-31j', 'x-sjis'].includes(candicate.toLowerCase())) return 'cp932';
		return candicate;
	} else {
		return null;
	}
}
