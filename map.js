// Import Mapbox as an ESM module
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

// Set your Mapbox access token here
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

// Select the SVG and define a helper function to get coordinates
const svg = d3.select('#map').select('svg');
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Format minutes as a time string
function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function computeStationTraffic(stations, trips) {
  // Compute departures
  const departures = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.start_station_id,
  );

  const arrivals = d3.rollup(
    trips,
    (v) => v.length,
    (d) => d.end_station_id,
  );

  // Update each station..
  return stations.map((station) => {
    let id = station.short_name;
    station.arrivals = arrivals.get(id) ?? 0;
    station.departures = departures.get(id) ?? 0;
    console.log(station.arrivals)
    station.totalTraffic = station.arrivals + station.departures;
    return station;
  });
}

function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips // If no filter is applied (-1), return all trips
        : trips.filter((trip) => {
            // Convert trip start and end times to minutes since midnight
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            // Include trips that started or ended within 60 minutes of the selected time
            return (
            Math.abs(startedMinutes - timeFilter) <= 60 ||
            Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

//Main Update 
map.on('load', async () => {
  map.addSource('boston_route', {
    type: 'geojson',
    data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson',
  });
  map.addSource('cambridge_route', {
    type: 'geojson',
    data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson',
  });
  map.addLayer({
    id: 'bike-lanes_boston',
    type: 'line',
    source: 'boston_route',
    paint: {
      'line-color': 'green',
      'line-width': 2,
      'line-opacity': 0.4,
    },
  });
  map.addLayer({
    id: 'bike-lanes_cambridge',
    type: 'line',
    source: 'cambridge_route',
    paint: {
      'line-color': 'green',
      'line-width': 2,
      'line-opacity': 0.4,
    },
  });

  //Load trips
  let trips = await d3.csv(
    'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
    (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
    },
  );

  // Load station data
  let jsonData;
  try {
    jsonData = await d3.json('https://dsc106.com/labs/lab07/data/bluebikes-stations.json');
    console.log('Loaded JSON Data:', jsonData);
  } catch (error) {
    console.error('Error loading JSON:', error);
  }

  const stations = computeStationTraffic(jsonData.data.stations, trips)

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, d3.max(stations, (d) => d.totalTraffic)])
    .range([0, 25]);

  // Draw circles
  const circles = svg
    .selectAll('circle')
    .data(stations, (d) => d.short_name)
    .enter()
    .append('circle')
    .attr('r', d => radiusScale(d.totalTraffic))
    .attr('fill', 'steelblue')
    .attr('stroke', 'white')
    .attr('stroke-width', 1)
    .attr('opacity', 0.8)
    .attr('cx', d => getCoords(d).cx)
    .attr('cy', d => getCoords(d).cy)
    .append('title')
    .text(d => `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);

  function updatePositions() {
    svg.selectAll('circle')
      .attr('cx', d => getCoords(d).cx)
      .attr('cy', d => getCoords(d).cy);
  }

  updatePositions();
  map.on('move', updatePositions);
  map.on('zoom', updatePositions);
  map.on('resize', updatePositions);
  map.on('moveend', updatePositions);

  const timeSlider = document.getElementById('time-slider');
  const selectedTime = document.getElementById('time-display');
  const anyTimeLabel = document.getElementById('any-time');

  function updateTimeDisplay() {
    const timeFilter = Number(timeSlider.value); // Get slider value

    if (timeFilter === -1) {
        selectedTime.textContent = ''; // Clear time display
        anyTimeLabel.style.display = 'block'; // Show "(any time)"
    } else {
        selectedTime.textContent = formatTime(timeFilter); // Display formatted time
        anyTimeLabel.style.display = 'none'; // Hide "(any time)"
    }

    updateScatterPlot(timeFilter);
  }

  function updateScatterPlot(timeFilter) {
    // Get only the trips that match the selected time filter
    const filteredTrips = filterTripsbyTime(trips, timeFilter);

    // Recompute station traffic based on the filtered trips
    const filteredStations = computeStationTraffic(stations, filteredTrips);
    timeFilter === -1 ? radiusScale.range([0, 25]) : radiusScale.range([3, 50]);

    // Update the scatterplot by adjusting the radius of circles
    circles
        .data(filteredStations, (d) => d.short_name)
        .join('circle') // Ensure the data is bound correctly
        .attr('r', (d) => radiusScale(d.totalTraffic)); // Update circle sizes
  }

  timeSlider.addEventListener('input', updateTimeDisplay);
  updateTimeDisplay();
});
