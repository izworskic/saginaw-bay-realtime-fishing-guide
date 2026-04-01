const { fetchAllReports } = require("./_lib/report-sources");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");

  try {
    const data = await fetchAllReports();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: "Report fetch failed",
      message: err.message || "Unknown error",
      generatedAt: new Date().toISOString(),
    });
  }
};
