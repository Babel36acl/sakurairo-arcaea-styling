import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const listenHost = process.env.VISUAL_PROXY_HOST || "127.0.0.1";
const listenPort = Number(process.env.VISUAL_PROXY_PORT || 18081);
const upstreamHost = process.env.VISUAL_UPSTREAM_HOST || "127.0.0.1";
const upstreamPort = Number(process.env.VISUAL_UPSTREAM_PORT || 18080);
const wordpressHost = process.env.VISUAL_WORDPRESS_HOST || "babel36acl.xyz";
const publicOrigin = `http://${listenHost}:${listenPort}`;
const serveHomeFixture = process.env.VISUAL_PROXY_HOME_FIXTURE === "1";
const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reference/fixtures/gallery.json");
const homeFixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../reference/fixtures/home.html");
const gallery = await fs.readFile(fixturePath, "utf8").then(JSON.parse).catch((error) => {
	if (error.code !== "ENOENT") throw error;
	return {};
});
const homeFixture = await fs.readFile(homeFixturePath, "utf8").catch((error) => {
	if (error.code !== "ENOENT") throw error;
	return null;
});
const pendingGallery = new Map();

const hopByHopHeaders = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

function rewriteInternalUrls(text) {
	return text
		.replaceAll(`https:\\/\\/${wordpressHost}`, publicOrigin)
		.replaceAll(`http:\\/\\/${wordpressHost}`, publicOrigin)
		.replaceAll(`https://${wordpressHost}`, publicOrigin)
		.replaceAll(`http://${wordpressHost}`, publicOrigin)
		.replaceAll(`//${wordpressHost}`, publicOrigin)
		.replaceAll("http://127.0.0.1/", `${publicOrigin}/`);
}

const server = http.createServer(async (request, response) => {
	const requestUrl = new URL(request.url || "/", publicOrigin);
	if (serveHomeFixture && homeFixture && request.method === "GET" && requestUrl.pathname === "/") {
		const content = rewriteInternalUrls(homeFixture);
		response.writeHead(200, {
			"content-type": "text/html; charset=UTF-8",
			"cache-control": "no-store",
			"content-length": Buffer.byteLength(content),
		});
		response.end(content);
		return;
	}
	if (requestUrl.pathname === "/wp-json/sakura/v1/gallery") {
		try {
			const key = requestUrl.searchParams.get("img") || "w";
			if (!gallery[key]) {
				if (!pendingGallery.has(key)) pendingGallery.set(key, (async () => {
					const result = await fetch(`http://${upstreamHost}:${upstreamPort}${requestUrl.pathname}?img=${encodeURIComponent(key)}`, { headers: { Host: wordpressHost }, redirect: "manual" });
					const location = result.headers.get("location");
					if (!location) throw new Error(`Gallery did not redirect: ${result.status}`);
					gallery[key] = { location, capturedAt: new Date().toISOString() };
					await fs.mkdir(path.dirname(fixturePath), { recursive: true });
					await fs.writeFile(fixturePath, `${JSON.stringify(gallery, null, 2)}\n`);
				})());
				await pendingGallery.get(key);
			}
			response.writeHead(302, { location: rewriteInternalUrls(gallery[key].location), "cache-control": "no-store" });
			response.end();
		} catch (error) {
			response.writeHead(502, { "content-type": "text/plain" });
			response.end(String(error));
		}
		return;
	}
	const headers = { ...request.headers, host: wordpressHost };
	for (const key of hopByHopHeaders) delete headers[key];
	delete headers["content-length"];
	headers["accept-encoding"] = "identity";
	const upstream = http.request(
		{
			// The SSH/Apache path resets idle keep-alive sockets. A fresh upstream
			// connection prevents ECONNRESET on reused sockets without hiding failures.
			agent: false,
			host: upstreamHost,
			port: upstreamPort,
			path: new URL(request.url || "/", publicOrigin).pathname + new URL(request.url || "/", publicOrigin).search,
			method: request.method,
			headers,
		},
		(upstreamResponse) => {
			if (upstreamResponse.statusCode >= 400) console.error(`Upstream HTTP ${upstreamResponse.statusCode} ${request.method} ${requestUrl.pathname}`);
			const outputHeaders = {};
			for (const [key, value] of Object.entries(upstreamResponse.headers)) {
				if (!hopByHopHeaders.has(key.toLowerCase())) outputHeaders[key] = value;
			}
			delete outputHeaders["content-encoding"];
			if (outputHeaders.location) outputHeaders.location = rewriteInternalUrls(String(outputHeaders.location));
			const contentType = String(upstreamResponse.headers["content-type"] || "");
			const shouldRewrite = /text\/(html|css)|javascript|json/i.test(contentType);
			if (!shouldRewrite) {
				response.writeHead(upstreamResponse.statusCode || 502, outputHeaders);
				upstreamResponse.pipe(response);
				return;
			}
			const chunks = [];
			upstreamResponse.on("data", (chunk) => chunks.push(chunk));
			upstreamResponse.on("end", () => {
				const content = rewriteInternalUrls(Buffer.concat(chunks).toString("utf8"));
				delete outputHeaders["content-length"];
				outputHeaders["content-length"] = Buffer.byteLength(content);
				response.writeHead(upstreamResponse.statusCode || 502, outputHeaders);
				response.end(content);
			});
		});
	upstream.on("error", (error) => {
			console.error(`Upstream transport ${error.code} reusedSocket=${upstream.reusedSocket}: ${request.method} ${requestUrl.pathname}`);
			response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
			response.end(`Reference proxy upstream error: ${error.message}`);
		});
	request.pipe(upstream);
});

server.listen(listenPort, listenHost, () => {
	console.log(`Reference proxy listening at ${publicOrigin}; upstream http://${upstreamHost}:${upstreamPort} as ${wordpressHost}`);
});

function shutdown() {
	server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
