import crypto from "crypto";

export function base64url(input: string | Buffer): string {
    return Buffer.from(input)
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

export function signJwtRS256(payloadObj: object, privateKeyPem: string): string {
    const header = { alg: "RS256", typ: "JWT" };
    const headerB64 = base64url(JSON.stringify(header));
    const payloadB64 = base64url(JSON.stringify(payloadObj));
    const data = `${headerB64}.${payloadB64}`;

    const signer = crypto.createSign("RSA-SHA256");
    signer.update(data);
    signer.end();

    const signature = signer.sign(privateKeyPem);
    const sigB64 = base64url(signature);
    return `${data}.${sigB64}`;
}

export function normalizePem(pemRaw: string | undefined): string | undefined {
    if (!pemRaw) return pemRaw;

    let pem = pemRaw.trim().replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n");

    if (!pem.includes("\n")) {
        const headerMatch = pem.match(/-----BEGIN [^-]+-----/);
        const footerMatch = pem.match(/-----END [^-]+-----/);
        if (!headerMatch || !footerMatch) return pem;

        const header = headerMatch[0];
        const footer = footerMatch[0];

        let body = pem.replace(header, "").replace(footer, "").replace(/\s+/g, "");
        body = body.match(/.{1,64}/g) ? body.match(/.{1,64}/g)!.join("\n") : body;

        pem = `${header}\n${body}\n${footer}\n`;
    }
    return pem;
}
