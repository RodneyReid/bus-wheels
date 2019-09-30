/* globals maps, fontawesome, SlidingMarker, Draggabilly, document, google, fetch */
/**
 * @file Code for the Google map.  Pulls/draws route patterns, then continually updated lat/longs of vehicles. puts them, animated, on the map.
 * @author Rodney T Reid
 */
'use strict'

// <bugs-nicetohaves>
//  (performance-med)     Dont get full vehicle latlng history (since server start) on startup!
//  (performance-easy)    When vehicle is in expanded map, put that route in "fast" lane for updates, if it's not already there
//                        This also goes for selected routes on a page, if fast queue isnt full
//  (ui-trivial)          Northern restriction of map needs to go a little higher for MCTS
//  (ui-feature-trivial)  Clicking on route list should do _something_ - right now is a no op
// </bugs-nicetohaves>
//
// <future>
//   This started out as a proof of concept, and now it's overgrown that, as I continue to add new
//   features/functionality.   We want to put this into Vue, and use Fastify on the back-end (<- fastify, done!)
// </future>
// how much do I want to scale my vehicles?  depends on zoom level.  Do they get labels? depends on zoom level
const zoomPerScale =  [0.01, 0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.2, 0.2, 0.2, 0.2, 0.3, 0.4, 0.4, 0.4, 0.5, 0.5]
const zoomFontSizes = [   0,    0,    0,    0,    3,    3,    3,    4,    4,    4,   5,   5,   7,   8,   8,   9,  10,  10,  11,  12,  12]

const compassPoints = [ // not used yet - should go on the vehicle display
  [0,   'N',    'north'], 
  [22,  'NNE',  'north-northeast'],
  [45,  'NE',   'northeast'],
  [68,  'ENE',  'east-northeast'],
  [90,  'E',    'east'],
  [112, 'ESE',  'east-southeast'],
  [135, 'SE',   'southeast'],
  [158, 'SSE',  'south-southeast'],
  [180, 'S',    'south'],
  [202, 'SSW',  'south-southwest'],
  [225, 'SW',   'southwest'],
  [248, 'WSW',  'west-southwest'],
  [270, 'W',    'west'],
  [293, 'WNW',  'west-northwest'],
  [315, 'NW',   'northwest'],
  [338, 'NNW',  'northnorthwest']
]
let busData = {} // all bus updates get dumped here, by vehicle id#
// @todo - instead of continually adding to busData vids, we should trim
//         them to a reasonable amount (say last 20 updates?), and optionally
//         dump the rest to a database if we care that much

let map, mapOv // the google map, and the google overlay map
let draggies = [] // For draggabilly - allows us to drag around DIVs
let expandPolyline = false // the bus route pattern for the expanded map
let expandVehicle = false // the vehicle (marker) on the expanded map 
let expandVid = 0 // what's the vehicleId being shown on expanded map?
let expandRoute = 0 // what's the route of the expanded map shown vehicle?

let routes = {} // key is route
const pidPaths = {} // key is pathID
const pidDrawn = {} // key is pathID
let pathsBolded = [] // which pids are lit up right now?  We need this to dim later

let dataPaused = false // are we focused away from page? then don't do fetches
let pauseStart // when did we focus away from page?
let curZoom = 12
let curZoomScale = 0.3
let curZoomFontSize = "10pt"

// Delete a bus that isn't seen anymore
// @param {string} vid - vehicle id # of bus to delete
const deleteBus = (vid) => {
  console.log(`-🚌 ${vid} Rt: ${busData[vid][0].rt} has left the building...`)
  busData[vid][0].map.setMap(null)
  delete busData[vid]
}

// find route PIDs
// @param {string} rt - Bus route we want (active) PIDs for
// @return {array} unique PIDs matched
const findRoutePids = rt => {
  let foundPids = []

  for (let x in busData) 
    if (busData[x][0].rt === rt) 
      foundPids.push('' + busData[x][0].pid)
 
  return [...new Set(foundPids)]
}

// turns a route on or off, depending on object's state
// @param {string} id - css id is also the route (with a preceding x)
const toggleRoute = e => {
  const rt = e.substr(1) // don't want that preceding x
}

// If we roll over a route we want to highlight the route patterns
// and (future) highlight the buses and show some info on the route
// @param {string} id - css id is also the route (with a preceding x)
const routeMouseOver = e => {
  let rt = e.substr(1)
  const pids = findRoutePids(rt)
  console.dir(pids)
  pathsBolded = []

  for (let x in busData) {
    const pid = '' + busData[x][0].pid
    if (pids.includes(pid)) {
      pathsBolded.push(pid)
      pidDrawn[pid].setOptions({ strokeWeight: 4})
    }
  }
}

// mouseOut reverses highlight from mouseOVer
// @param {string} e - the route css id (strip first char for route#)
const routeMouseOut = e => {
  const rt = e.substr(1) 
  
  for (var x = 0; x !== pathsBolded.length; x++) {
    pidDrawn[pathsBolded[x]].setOptions({ strokeWeight: 1})
  }
}
// removes inactive vehicles from the map
// TODO: removes inactive PIDS/routes too (optional), and inactivates routes if necessary
const pruneVehicles = () => {
  const keys = Object.keys(busData)
  const rt = Object.keys(routes)
  
  for (let x = 0; x !== keys.length; x++) {
    let ve = busData[keys[x]][0]

    if (ve.updated < (Date.now() - (1000*60*6))) { // Haven't updated GPS in 6 minutes?  long enough!
      deleteBus(keys[x])
    } else {
      // we're not pruning.  @todo - get rid of else if not using it
    }
  }
}

// zoomChanged changes the size of bus icons and captions depending on zoom level.
//
const zoomChanged = () => {
  curZoom = map.getZoom()
  // zoom levels 10-20.  12 is default.
  
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
// @param {string} key - vehicle id #
async function displayBus(key) {
  const bus = busData[key][0]
  bus.map = new SlidingMarker({
    duration: 3000,
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

// Add a new bus to the fray, and display it.
// @param {string} key - the vehicle ID
// @param {object} busInfo - information about the vehicle - lat/long, last update, route, direction, etc
// @return nothing
const addBus = (key, busInfo) => {
  busData[key] = []
  busData[key].push(busInfo)
  console.log(`+🚌 ${key} Rt: ${busData[key][0].rt} added`)
  displayBus(key)
}

// mapUpdates - get new data, and if the vehicle already on map, move/update it, else add a vehicle
// @return nothing
async function mapUpdates() {
  let updates = await updateBusData()
  let keys = Object.keys(updates)
  keys.forEach(key => {
    if (key in busData) {
      const curBus = busData[key][0] // UNUSED?!?
      const upd = updates[key]
      const latlng = { lat: parseFloat(upd.lat), lng: parseFloat(upd.lon) }
      if (key === expandVid && expandVid) {
        mapOv.panTo(latlng)
        if (expandVehicle) {
          expandVehicle.setPosition(latlng)
        }
      }

      busData[key][0].map.setPosition(latlng)
    } else {
      addBus(key, updates[key])
    }
  })
  // @todo: sometimes it will immediatly add a vehicle and then prune it - 
  //       impedance mismatch between frontend and backend calc'd code
  pruneVehicles()
}

async function updateBusData() {
  let response = await fetch('/busupdates')
  response = await response.json()
  return response
}

// get (if uncached) the pattern for the pid, and draw it in the color
// @param {string} pid - pattern id
// @param {string} route - route id
// @param {string} color - css standard color string, to color the pattern with
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
// @@todo - geez I really have to set up vue/react/lit-html with this project
// because this style is yawn old
const buildRouteUI = () => {
  let col = 0
  let out = `<div id="routes" class="routes"><div class="routerow">`
  
  for (let rt in routes) {
    col++    
    if (col > 9) {
      col = 0
      out += `</div><div class="routerow">`
    }
    out += `<div class="route" id="x${rt}" style="background-color:${routes[rt].clr}" onmouseover="routeMouseOver(this.id)" onmouseout="routeMouseOut(this.id)" onclick="toggleRoute()">${rt}</div>`
  }
  out += `</div></div>`
  document.getElementById('routecontainer').innerHTML = out
}

// Get all the routes, store them in the route object, build route selector
// @todo - this should also get all the patterns too in one swoop
async function getRoutes() {
  let response = await fetch('/routes')
  routes = await response.json()
  buildRouteUI()
}

// Show a popup window giving information on the vehicle, when vehicle clicked.
// @todo - something so we can only have one clicked at a time.
//         also - maps.Infowindow isn't going to work for us - put in floating div
// @param {object} marker - map marker (that looks like a bus)
// @param {string} key - vehicle id#
const makeClickFunction = (marker, key) => {
  const infowindow = new google.maps.InfoWindow({
    content: `
      <b>Vehicle ID</b> ${busData[key][0].vid}<br />
      <b>Route/Dest</b> ${busData[key][0].rt}/${busData[key][0].des}<br />
      <b>Head/Speed</b> ${busData[key][0].hdg}deg/${busData[key][0].spd}mph<br />
      `
  })

  marker.addListener('click', () => {
    // if (curZoom < 15) map.setZoom(15)  
    // the above doesn't mesh well with the overlay map nav so removed for now
    map.setCenter(marker.getPosition())
    mapOv.setCenter(marker.getPosition())
    infowindow.open(marker.get('map'), marker)
    document.getElementById('routeinfo').innerHTML = `
      <b>Vehicle ID</b> ${busData[key][0].vid}<br />
      <b>Route/Dest</b> ${busData[key][0].rt}/${busData[key][0].des}<br />
      <b>Head/Speed</b> ${busData[key][0].hdg}deg/${busData[key][0].spd}mph<br />
    `
    const mpath = []
    
    pidPaths[busData[key][0].pid].forEach(pObj => {
      mpath.push({ lat: pObj.lat, lng: pObj.lon})
    })

    if (expandPolyline) expandPolyline.setMap(null)
    expandPolyline = new google.maps.Polyline({
      path: mpath,
      strokeColor: routes[busData[key][0].rt].clr,
      strokeOpacity: 0.7,
      strokeWeight: 2
    })
    expandPolyline.setMap(mapOv)
    const bus = busData[key][0]
    if (expandVehicle) expandVehicle.setMap(null)
    expandVid = key
    expandRoute = bus.rt
    expandVehicle = new SlidingMarker({
      duration: 2500,
      easing: "linear",
      position: {
        lat: parseFloat(bus.lat), 
        lng: parseFloat(bus.lon)
      },
      map: mapOv,
      icon: {
        path: fontawesome.markers.BUS,
        scale: zoomPerScale[zoomPerScale.length - 1],
        strokeWeight: 0.2,
        strokeColor: '#aaa',
        strokeOpacity: 1,
        fillColor: routes[busData[key][0].rt].clr,
        fillOpacity: 0.8,
        labelOrigin: google.maps.Point(3, -150)
      },
      label: {
        text: key,
        color: "#aaa",
        fontSize: zoomFontSizes[zoomFontSizes.length - 1] + 'pt'
      }
    })
  })
}

// was getBusData.   initMap hooks up the two maps, 
async function initMap() {
  const draggableElems = document.querySelectorAll('.draggable')
  
  // init Draggabillies
  for (let i = 0; i < draggableElems.length; i++) {
    const draggie = new Draggabilly(draggableElems[i], {
      // options...
    })
    draggies.push(draggie)
  }

  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 12, 
    center: {lat: 43.038902, lng: -87.9065}, 
    restriction: {
      latLngBounds: {north: 43.279, south: 42.870, west: -88.126, east: -87.81},
      strictBounds: false
    },
    minZoom: 10,
    maxZoom: 20,
    controlSize: 30,
    backgroundColor: "#334148",

    mapTypeControl: false,
    styles: [{featureType:"all",elementType:"all",stylers:[{invert_lightness:true},{saturation:10},{lightness:30},{gamma:0.5},{hue:"#435158"}]}]
  })
  mapOv = new google.maps.Map(document.getElementById('mapOv'), {
    zoom: 17, 
    center: {lat: 43.038902, lng: -87.9065}, 
    disableDefaultUI: true,
    draggable: false,
    disableDoubleClickZoom: true,
    gestureHandling: false,
    keyboardShortcuts: false,
    mapTypeControl: false,
    backgroundColor: "#334148",
    styles: [{featureType:"all",stylers:[{hue:"#0000b0"},{invert_lightness:"true"},{saturation:-30}]}],
  })

  map.addListener('zoom_changed', zoomChanged)

  await getRoutes()
  let response = await fetch('/buses')
  response = await response.json()
  
  busData = Object.assign({}, response)
  
  SlidingMarker.initializeGlobally()
  for (let key in busData) {
    displayBus(key)
  }

  setInterval(mapUpdates, 4000) // probably a little too fast; maybe negotiate with back-end, since it's only one user (ATM?) ---- also, make this setTimeout and on fire reenable it, so we can adjust speed along the way
  return response
}
  
  // called when pageVisibility triggers web page not visible (tabbed to another, minimized window, etc)
const pauseDataXfer = () => {
  dataPaused = true
  pauseStart = Date.now()
}

// called when pageVisibility says we're in view again
const resumeDataXfer = () => {
  dataPaused = false
  const pausedSeconds = (Date.now() - pauseStart) / 1000
  if (pauseStart && pausedSeconds > 100) {
    console.log(`Long delay/quick update on: ${pausedSeconds} seconds`)
    mapUpdates()
  }
  pauseStart = 0
}

/* Color shifting.  Should be handled by a library, not my code ;) */

// RGB2HSV and HSV2RGB are based on Color Match Remix [http://color.twysted.net/]
// which is based on or copied from ColorMatch 5K [http://colormatch.dk/]
// Forgive me, I didn't write this [rr]

// @param {array} rgb - array with red, green, blue values (0-255)
// @return {array} hsv - array with hue (0-360), saturation (0-100), value (0-100)
let RGB2HSV = rgb => {
  let hsv = {}
  let max = max3(rgb.r, rgb.g, rgb.b)
  let dif = max - min3(rgb.r, rgb.g, rgb.b)
  hsv.saturation = (max == 0.0) ? 0 : (100 * dif / max)
  
  if (hsv.saturation === 0) 
    hsv.hue = 0
  else if (rgb.r == max) 
    hsv.hue = 60.0 * (rgb.g - rgb.b) / dif
  else if (rgb.g == max) 
    hsv.hue = 120.0 + 60.0 * (rgb.b - rgb.r) / dif
  else if (rgb.b == max) 
    hsv.hue = 240.0 + 60.0 * (rgb.r - rgb.g) / dif
  
  if (hsv.hue < 0.0) hsv.hue+= 360.0
  
  hsv.value = Math.round(max * 100 / 255)
  hsv.hue = Math.round(hsv.hue)
  hsv.saturation = Math.round(hsv.saturation)

  return hsv
}

// Forgive me code gods, I didn't write this (but I cleaned it up a lot) [rr]
// @param {array} hsv - array with hue (0-360), saturation (0-100), value (0-100)
// @return {array} rgb - array with red, green, blue values (0-255)
let HSV2RGB = hsv => {
  let rgb = {}
  if (!hsv.saturation) {
    rgb.r = rgb.g = rgb.b = Math.round(hsv.value * 2.55)
  } else {
    hsv.hue /= 60
    hsv.saturation /= 100
    hsv.value /= 100

    let i = Math.floor(hsv.hue)
    let f = hsv.hue - i
    let p = hsv.value * (1 - hsv.saturation)
    let q = hsv.value * (1 - hsv.saturation * f)
    let t = hsv.value * (1 - hsv.saturation * (1 - f))

    switch(i) {
      case 0:
        rgb = { r: hsv.value, g: t, b: p }
        break
      case 1: 
        rgb = { r: q, g: hsv.value, b: p }
        break
      case 2: 
        rgb = { r: p, g: hsv.value, b: t }
        break
      case 3: 
        rgb = { r: p, g: q, b: hsv.value }
        break
      case 4: 
        rgb = { r: t, g: p, b: hsv.value }
        break
      default:
        rgb = { r: hsv.value, g: p, b: q }
    }
    rgb.r = Math.round(rgb.r * 255)
    rgb.g = Math.round(rgb.g * 255)
    rgb.b = Math.round(rgb.b * 255)
  }
  return rgb
}

// Shift the hue, don't let it run over.
// @param {number} h - the starting hue
// @param {number} s - how much to shift it by
// @return {number} Normalized hue
let HueShift = (h, s) => { 
  h += s
  while (h >= 360.0) h -= 360.0
  while (h < 0.0) h += 360.0

  return h
}

// Shift the luminence, don't let it run over.
// @param {number} l - the starting luminence 
// @param {number} s - how much to shift it by
// @return {number} normalized luminence
let LumShift = (l, s) => { 
  l += s 
  while (l >= 100.0) l -= 100.0 
  while (l < 0.0) l += 100.0 

  return l
}

//min max via Hairgami_Master (sidenote: i'd hate to see a min4/max4 min5/max5 in this style!)
const min3 = (a, b, c) => ((a < b) ? ((a < c) ? a : c) : ((b < c) ? b : c))
const max3 = (a, b, c) => ((a > b) ? ((a > c) ? a : c) : ((b > c) ? b : c))

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