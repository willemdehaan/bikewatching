import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1Ijoid2lsbGVtZGVoYWFuIiwiYSI6ImNtYXNydTFyMTByZmEybHB5c3NsbmR1NzcifQ.EKr6cnoIewy1Na5GjtxJkw';

// Initialize the map
const map = new mapboxgl.Map({
  container: 'map',
  style: 'mapbox://styles/willemdehaan/cmassxh9v01ib01spdh79e5y5',
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Create an SVG overlay on top of the map
const svg = d3.select('#map').select('svg');

// Step 5.4 Optimization: Pre-bucket trips by minute of day
const departuresByMinute = Array.from({ length: 1440 }, () => []);
const arrivalsByMinute   = Array.from({ length: 1440 }, () => []);

// Helper to project station lon/lat to pixel coordinates
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Helper to compute minutes since midnight from a Date
function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Format minutes to HH:MM AM/PM for display
function formatTime(minutes) {
  const d = new Date(0, 0, 0, 0, minutes);
  return d.toLocaleString('en-US', { timeStyle: 'short' });
}

// Efficiently filter trips by time using the precomputed buckets
function filterByMinute(tripsByMinute, minute) {
  if (minute === -1) return tripsByMinute.flat();
  const minM = (minute - 60 + 1440) % 1440;
  const maxM = (minute + 60) % 1440;
  if (minM > maxM) {
    return [...tripsByMinute.slice(minM), ...tripsByMinute.slice(0, maxM)].flat();
  } else {
    return tripsByMinute.slice(minM, maxM).flat();
  }
}

// Compute arrivals, departures, and totalTraffic for each station
function computeStationTraffic(stations, timeFilter = -1) {
  const depTrips = filterByMinute(departuresByMinute, timeFilter);
  const arrTrips = filterByMinute(arrivalsByMinute, timeFilter);
  const departures = d3.rollup(depTrips, v => v.length, d => d.start_station_id);
  const arrivals   = d3.rollup(arrTrips, v => v.length, d => d.end_station_id);

  return stations.map(s => {
    const id   = s.short_name;
    const dep  = departures.get(id) ?? 0;
    const arr  = arrivals.get(id)   ?? 0;
    return { ...s, departures: dep, arrivals: arr, totalTraffic: dep + arr };
  });
}

// Variables to store loaded data and elements
let stationsData;
let circles;
let radiusScale;
let stationFlow;

// Main render logic once Mapbox map is loaded
map.on('load', async () => {
  // 1) Add Boston and Cambridge bike-lane layers
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
  });
  map.addLayer({ id: 'bike-lanes_boston', type: 'line', source: 'boston_route', paint: {
    'line-color': 'green', 'line-width': 2, 'line-opacity': 0.4
  }});

  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
  });
  map.addLayer({ id: 'bike-lanes_cambridge', type: 'line', source: 'cambridge_route', paint: {
    'line-color': 'green', 'line-width': 2, 'line-opacity': 0.4
  }});

  // 2) Load trip data and fill minute buckets
  const trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    d => {
      d.started_at = new Date(d.started_at);
      d.ended_at   = new Date(d.ended_at);
      const sm = minutesSinceMidnight(d.started_at);
      const em = minutesSinceMidnight(d.ended_at);
      departuresByMinute[sm].push(d);
      arrivalsByMinute[em].push(d);
      return d;
    }
  );

  // 3) Load station metadata
  const stationJson = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
  stationsData = stationJson.data.stations.map(s => ({ ...s }));

  // 4) Initial compute & scales
  const initialStations = computeStationTraffic(stationsData);
  radiusScale = d3.scaleSqrt()
    .domain([0, d3.max(initialStations, d => d.totalTraffic)])
    .range([0, 25]);
  stationFlow = d3.scaleQuantize().domain([0,1]).range([0, 0.5, 1]);

  // 5) Draw initial circles
  circles = svg.selectAll('circle')
    .data(initialStations, d => d.short_name)
    .enter()
    .append('circle')
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy)
    .attr('r',  d => radiusScale(d.totalTraffic))
    .style('--departure-ratio', d => stationFlow(d.departures/d.totalTraffic))
    .append('title')
      .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

  // 6) Keep circles aligned on map moves
  function updatePositions() {
    circles
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  // 7) Slider & interactivity
  const timeSlider = document.getElementById('time-slider');
  const timeDisplay = document.getElementById('time-display');
  const anyTime     = document.getElementById('any-time');

  function updateTimeDisplay() {
    const tf = +timeSlider.value;
    if (tf === -1) {
      timeDisplay.textContent = '';
      anyTime.style.display = 'block';
    } else {
      timeDisplay.textContent = formatTime(tf);
      anyTime.style.display = 'none';
    }
    updateScatterPlot(tf);
  }

  function updateScatterPlot(timeFilter) {
    const updated = computeStationTraffic(stationsData, timeFilter);
    timeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles = svg.selectAll('circle')
      .data(updated, d => d.short_name)
      .join(
        enter => enter.append('circle')
          .attr('cx', d => getCoords(d).cx)
          .attr('cy', d => getCoords(d).cy)
          .attr('r',  d => radiusScale(d.totalTraffic))
          .style('--departure-ratio', d => stationFlow(d.departures/d.totalTraffic))
          .append('title')
            .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`),
        update => update.transition().duration(200)
          .attr('r',  d => radiusScale(d.totalTraffic))
          .style('--departure-ratio', d => stationFlow(d.departures/d.totalTraffic)),
        exit => exit.remove()
      );
    updatePositions();
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});