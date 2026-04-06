export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { downloadUrl, accessToken } = req.body;
  if (!downloadUrl || !accessToken) {
    return res.status(400).json({ error: "Missing downloadUrl or accessToken" });
  }

  const response = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return res.status(response.status).json({ error: `Google returned ${response.status}` });
  }

  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  res.status(200).json({ data: buffer.toString("base64"), contentType });
}
