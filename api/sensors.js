const { fetchAllSensors } = require("./_lib/sensor-sources");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");

  try {
    const data = await fetchAllSensors();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({
      error: "Sensor fetch failed",
      message: err.message || "Unknown error",
      generatedAt: new Date().toISOString(),
    });
  }
};
