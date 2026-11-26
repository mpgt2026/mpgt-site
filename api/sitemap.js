module.exports = (req, res) => {
  const host = 'www.manilapampangagotaxi.com';
  const paths = ["/", "/book", "/routes", "/faq", "/privacy", "/terms", "/routes/pampanga-to-metro-manila", "/routes/naia-clark-airport-transfer", "/routes/manila-to-baguio", "/routes/manila-to-tagaytay", "/routes/manila-to-batangas", "/routes/pampanga-to-tagaytay", "/routes/manila-to-clark-airport", "/routes/naia-to-pampanga", "/routes/manila-to-la-union", "/routes/manila-to-laguna", "/routes/manila-to-cavite", "/routes/manila-to-zambales", "/routes/manila-to-pangasinan", "/routes/manila-to-dingalan"];
  const urls = paths.map((p) => '  <url><loc>https://' + host + (p === '/' ? '/' : p) + '</loc></url>').join('\n');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).send('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + '\n</urlset>\n');
};
