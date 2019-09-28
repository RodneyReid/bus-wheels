'use strict'

let busData = {}
let routes = {} // simple.  key is route
let pidPaths = {}
let pidDrawn = {}
let dataPaused = false
let pauseStart
let curZoom = 12
let curZoomScale = 0.3
let curZoomFontSize = "10pt"

// Delete a bus that isn't seen anymore
const deleteBus = (key) => {
  // TODO we might have to do something with google maps too?
  console.log(`-🚌 ${key} Rt: ${busData[key][0].rt} has left the building...`)
  delete busData[key]

}

// removes inactive vehicles from the map
const pruneVehicles = () => {
  let keys = Object.keys(busData)

  for (let x = 0; x !== keys.length; x++) {
    let ve = busData[keys[x]][0]

    if (ve.updated < (Date.now() - (1000*60*6))) { // Haven't updated GPS in 6 minutes?  long enough!
      deleteBus(keys[x])
    }
  }
}

// zoomChanged modifies the size of bus icons (and optional captions) depending on level.
//
//
//
const zoomChanged = () => {
  curZoom = map.getZoom()
  // zoom levels 10-20.  12 is default.
  let zoomPerScale =  [0.01, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.4, 0.4, 0.5, 0.5]
  let zoomFontSizes = [   0,    0,    0,    0,    3,    3,    3,    4,    4,    4,   5,   5,   7,   8,   8,   9,  10,  10,  11,  12,  12]
  curZoomScale = zoomPerScale[curZoom]
  curZoomFontSize = zoomFontSizes[curZoom]

  for (let ve in busData) {
    let vehi = busData[ve][0]
    if (vehi.map) {
      let oldIcon = vehi.map.getIcon()
      vehi.map.setIcon({
        path: fontawesome.markers.BUS,
        scale: curZoomScale,
        strokeWeight: 0.2,
        strokeColor: '#aaa',
        strokeOpacity: 1,
        fillColor: oldIcon.fillColor,
        fillOpacity: 0.8,
      })
      
      if (curZoom >= 14) {
        vehi.map.setLabel({
          text: ve,
          color: "#aaa",
          fontSize: curZoomFontSize + 'pt'
        })
      } else {
        vehi.map.setLabel(null)
      }
    }
  }
}


// displayBus -  adds a bus to the map, and the route if none exists yet.
// @param key string - vehicle #
//
async function displayBus(key) {
  const bus = busData[key][0]
  bus.map = new SlidingMarker({
    duration: 10000,
    easing: "linear",
    position: {
      lat: parseFloat(bus.lat), 
      lng: parseFloat(bus.lon)
    },
    map: map,
    icon: {
      path: fontawesome.markers.BUS,
      scale: curZoomScale,
      strokeWeight: 0.2,
      strokeColor: '#aaa',
      strokeOpacity: 1,
      fillColor: routes[bus.rt].clr,
      fillOpacity: 0.8,
    }
  })
  if (curZoom >= 14) {
    bus.map.setLabel({
      text: key,
      color: "#aaa",
      fontSize: curZoomFontSize + 'pt'
    })
  } else {
    bus.map.setLabel(null)  
  }
  makeClickFunction(bus.map, key) // key is vid#
  
  await drawPattern('' + bus.pid, bus.rt, routes[bus.rt].clr) // its smart; it doesn't draw it twice
}

// Add a new bus to the fray
const addBus = (key, busInfo) => {
  busData[key] = []
  busData[key].push(busInfo)
  console.log(`+🚌 ${key} Rt: ${busData[key][0].rt} added`)
  displayBus(key)
}


async function mapUpdates() {
  let updates = await updateBusData()
  let keys = Object.keys(updates)
  keys.forEach(key => {
    if (key in busData) {
      const curBus = busData[key][0]
      const upd = updates[key]
      busData[key][0].map.setPosition({
        lat: parseFloat(upd.lat),
        lng: parseFloat(upd.lon)
      })
    } else {
      addBus(key, updates[key])
    }
  })
  pruneVehicles()
}

async function updateBusData() {
  let response = await fetch('/busupdates')
  response = await response.json()
  return response
}

// get (if uncached) the pattern for the pid, and draw it in the color
// 
async function drawPattern(pid, route, color) {
  let response
  if (pid in pidPaths) {
    // we don't care - we alreadty drew it
  } else {
    response = await fetch(`pattern/${route}/pid/${pid}`)
    response = await response.json()
    pidPaths[pid] = JSON.parse(JSON.stringify(response.pt))

    let mpath = []

    pidPaths[pid].forEach(pObj => {
      mpath.push({ lat: pObj.lat, lng: pObj.lon})
    })
    pidDrawn[pid] = new google.maps.Polyline({
      path: mpath,
      strokeColor: color,
      strokeOpacity: 0.7,
      strokeWeight: 1
    })
    pidDrawn[pid].setMap(map)
  }
}

// The route selector UI - takes the list of routes and makes 
// clickable icons (with route# in route color) in a floating div
const buildRouteUI = () => {
  let col = 0
  let row = 0
  let count = 0
  let total = Object.keys(routes).length
  let out = `<div id="routes" class="routes"><div class="routerow">`
  
  for (let rt in routes) {
    count++
    col++    
    if (col > 9) {
      row++
      out += `</div><div class="routerow">`
      col = 0
    }
    out += `<div class="route" id="x${rt}" style="background-color:${routes[rt].clr}" onclick="toggleRoute()">${rt}</div>`
  }
  out += `</div></div>`
  document.getElementById('routecontainer').innerHTML = out
}



async function getRoutes() {
  let response = await fetch('/routes')
  routes = await response.json()
  buildRouteUI()
}

const makeClickFunction = (marker, key) => {
  const infowindow = new google.maps.InfoWindow({
    content: `
      <b>Vehicle ID</b> ${busData[key][0].vid}<br />
      <b>Route/Dest</b> ${busData[key][0].rt}/${busData[key][0].des}<br />
      <b>Head/Speed</b> ${busData[key][0].hdg}deg/${busData[key][0].spd}mph<br />
      `
  })

  marker.addListener('click', function() {
      if (curZoom < 15) map.setZoom(15)
      map.setCenter(marker.getPosition())
      infowindow.open(marker.get('map'), marker)
  })
}

async function getBusData() {
  
  map.addListener('zoom_changed', zoomChanged)

  await getRoutes()
  let response = await fetch('/buses')
  response = await response.json()
  
  busData = Object.assign({}, response)
  
  SlidingMarker.initializeGlobally()
  for (let key in busData) {
    displayBus(key)
  }

  setInterval(mapUpdates, 10500) // we now made this faster x 2!
  return response
}

const pauseDataXfer = () => {
  dataPaused = true
  pauseStart = Date.now()
}

const resumeDataXfer = () => {
  dataPaused = false
  if (pauseStart && ((Date.now() - pauseStart) / 1000) > 100) {
    console.log(`Long delay/quick update on: ${(Date.now() - pauseStart) / 1000} seconds`)
    mapUpdates()
  }
  pauseStart = 0
}

// Set the name of the hidden property and the change event for visibility
let hidden, visibilityChange, vis = "visibilitychange"

if (typeof document.hidden !== "undefined") hidden = "hidden", visibilityChange = vis
else if (typeof document.msHidden !== "undefined") hidden = "msHidden", visibilityChange = `ms${vis}`
else if (typeof document.webkitHidden !== "undefined") hidden = "webkitHidden", visibilityChange = `webkit${vis}`

// If the page is hidden, dont grab anymore bus data.
// if the page is shown, grab bus data again -- if > time it would normally have gotten it.  restart interval
const handleVisibilityChange = () => document[hidden] ? pauseDataXfer() : resumeDataXfer()

if (typeof document.addEventListener === "undefined" || hidden === undefined) {
  console.log("You don't support the Page Visibility API. - bummer!")
} else {
  document.addEventListener(visibilityChange, handleVisibilityChange, false)
}

