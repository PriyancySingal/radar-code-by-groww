// Seed universe: a handful of liquid NSE-style names across sectors,
// so sector/market divergence has something real to compare against.
const SYMBOLS = [
  { symbol: "TCS", name: "Tata Consultancy Services", sector: "IT", basePrice: 3900 },
  { symbol: "INFY", name: "Infosys", sector: "IT", basePrice: 1550 },
  { symbol: "WIPRO", name: "Wipro", sector: "IT", basePrice: 480 },
  { symbol: "HDFCBANK", name: "HDFC Bank", sector: "BANKING", basePrice: 1650 },
  { symbol: "ICICIBANK", name: "ICICI Bank", sector: "BANKING", basePrice: 1180 },
  { symbol: "SBIN", name: "State Bank of India", sector: "BANKING", basePrice: 820 },
  { symbol: "RELIANCE", name: "Reliance Industries", sector: "ENERGY", basePrice: 2950 },
  { symbol: "ONGC", name: "ONGC", sector: "ENERGY", basePrice: 260 },
  { symbol: "NTPC", name: "NTPC", sector: "ENERGY", basePrice: 360 },
  { symbol: "MARUTI", name: "Maruti Suzuki", sector: "AUTO", basePrice: 12500 },
  { symbol: "TATAMOTORS", name: "Tata Motors", sector: "AUTO", basePrice: 950 },
  { symbol: "SUNPHARMA", name: "Sun Pharma", sector: "PHARMA", basePrice: 1780 },
  { symbol: "DRREDDY", name: "Dr Reddy's Labs", sector: "PHARMA", basePrice: 1250 },
  { symbol: "ITC", name: "ITC Limited", sector: "FMCG", basePrice: 465 },
  { symbol: "HINDUNILVR", name: "Hindustan Unilever", sector: "FMCG", basePrice: 2550 },
];

module.exports = { SYMBOLS };
