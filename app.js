/* jshint asi: true, node: true */
/**
 * @file Runs the fastify webserver, grabs data from clever device's BusTime API
 *       for bus services for display on a google map
 *       To my knowledge, this will work with AC Transit (Oakland), 
 *       MCTS (Milwaukee), CTA (Chicago), MTA (?)
 *
 * @author Rodney T Reid
 * @version 1.0
 */

'use strict'
const fastify = require('fastify')({
  logger: true
})

const fetch = require('node-fetch') // you can take this out once node has native fetch()
const fs = require('fs')
const path = require('path')

const patterns = require('./routes.json') // create this file by running refreshRoutes.js
const agencies = require('./agencies.json') // all busapi enabled agencies - please add to this
const port = 3000

// Set the following in your enviroment; ( ex: export TAGENCKEY="----your key---" )
const TAGENCY = process.env.TAGENCY
const TAGENCYKEY = process.env.TAGENCYKEY
const GMAPSKEY = process.env.GMAPSKEY  // GOOGLE MAPS get your own key: https://developers.google.com/maps/documentation/embed/get-api-key
// const MAPBOX_KEY = process.env.MAPBOXKEY // MAPBOX GL (not used yet) get your own key: https://docs.mapbox.com/help/how-mapbox-works/access-tokens/

let BUSURL
let BUSVEHICLES

let apiCalls = 0 // how many calls have we made so far?  Usual max is 10k a day so am trying to avoid that!
let routePatterns = {} // lat/long points for routes, along with stop points
let myRoutes = []
let activeRoutes = {}  // which routes have buses on them, and how many? key is routeid, val is count
let activeCheckTime = Date.now()
let activeVehicles = {} // key: bus id - arrays of objects w/route (yes, redundant. TODO), lat/long, speed, last update, delayed?, heading, destination
let startTime // when we started getting data

let clientRoutes = {} // key is route, then last query
let clientProcs = {} // key is fastify process ID, data is last request time, first req time, requests

let updRequests = 0 // how many update requests from the client?
let updLastReq = 0  // when was the last update request?
let watchList = [] // @todo - this should be by connectionID

// The Scheduler --- see comments
let sch = {
  ticks: -1, // goes up one every tickSpeed milliseconds (-1 is to start w/sync)
  syncTime: new Date(), // last time we synched
  tickSpeed: 5000, // 21000, // in milliseconds
  syncTick: 20, // we sync all routes every syncTick
  slowTick: 4, // we get the top 30 every slowTick, 
  fastTick: 1, // else we get the top 10 for the rest of the ticks
}

/**
 * Get all the routes without any of the fluf
 * @return array routes list.  ex:   ['BLU', '59', '55', '30X', ...]
**/
const getAllRoutes = () => Object.keys(patterns)

/**
 * getCurrentRoutes is a complex beast; the reasoning is I didn't want
 * to go over the 10,000 maximum API calls a day, and this further limited
 * the number of calls done but got the highest # of bus updates.
 * 
 * Every 20 ticks, we return back the whole list of routes
 * Every 4 ticks, we return at most 30 of the top routes with buses
 * Otherwise, we return at most 10 of the top routes with buses
 * @return array routes list.  ex:   ['BLU', '59', '55', '30X', ...]
 *
 * @todo this is not going to work as well with CTA/Chicago or Oakland - sch has to be better
 * @todo this relies heavily on the sch struct, so make into a class?
 * @todo future idea:  once (in the PM) we get to a point where:
 *  active routes < 30, we switch the sync to grab the top 30 routes, 
 *  and the slowTick to grab top 20.
 *  active routes < 20, we switch the sync to grab top 20, and keep slowTick at top 20.
 *  activeRoutes < 10, change the sync to just those.
 *  activeRoutes = 0, flip the PM clock to new day.  change slowTick and fastTick
 *  so they don't do anything.  SyncTick now pulls all routes. 
 *  activeRoutes > 0 (at least one active route), we can change  the slowTick and
 *  fastTick back to their normal values.
**/
const getCurrentRoutes = () => {
  sch.ticks++
  
  if ((sch.ticks % sch.syncTick) === 0) {
    sch.syncTime = Date.now()
    return getAllRoutes()
  } 

  // get list of routes w/currently running vehicles (seen since last full pull)
  let curRoutes = {}
  let sortRoutes = []
  let deadVehicles = 0
  let runningVehicles = 0
  let returned = []

  for (let v in activeVehicles) {
    let ve = activeVehicles[v][0]

    if (ve.updated > (sch.syncTime - (1000*60*4))) { // 4 min before last sync
      runningVehicles++
      if (ve.rt in curRoutes) curRoutes[ve.rt]++
      else curRoutes[ve.rt] = 1
    } else deadVehicles++ // might be an interesting metric; unused
  }

  for (let [key, value] of Object.entries(curRoutes)) {
    sortRoutes.push([key, value])
  }
  
  let sortedRoutes = sortRoutes.sort((a, b) => b[1] - a[1])
  
  const max = (sch.ticks % sch.slowTick === 0) ? 30 : (sch.ticks % sch.fastTick === 0) ? 10 : 0
  sortedRoutes.forEach(el => {
    if (returned.length < max) returned.push(el[0])
  })
  return returned
}

/**
 * Bundles the current routes in groups of ten, then concurrently fetches them all
**/
async function getActiveRoutes() {
  const MAXLENGTH = 10 // imposed by clever devices API

  let routes = await getCurrentRoutes()
  let arrayOfRoutes = [] // bunches of routes for each fetch in the promiseALl
  
  activeRoutes = {} // start fresh with this metric

  // Bunch up the routes in groups of MAXLENGTH(10)
  for (let x = 0; x < routes.length; x += MAXLENGTH) {
    arrayOfRoutes.push(routes.slice(x, x + MAXLENGTH))
  }
  // Do all the fetches concurrently
  await Promise.all(arrayOfRoutes.map(async routes => {  
    await getVehicles(routes.join(',')) 
  }))

  // this section is only for logging
  let retVal = Object.keys(activeRoutes) 
  let doneTime = new Date()

  console.dir(`${doneTime.toISOString()} --> ${JSON.stringify(activeRoutes)}`)
  const sum = (arr) => Object.values(activeRoutes).reduce((total, item) => total += parseInt(item, 10), 0)
  console.log(`routes: ${retVal.length} buses: ${sum()}`)
}

// This is what routes.json looks like (but not all 400k lines!)
/*** {
  "12": {
    "nm": "Teutonia-Hampton",
    "dd": "12",
    "clr": "#8dc63f",
    "ptr": [{
      "pid": 10596,
      "ln": 57770,
      "rtdir": "WEST",
      "pt": [{
        "seq": 1,
        "lat": 43.035509951778,
        "lon": -87.91756,
        "typ": "S",
        "stpid": "1749",
        "stpnm": "5TH STREET + CLYBOURN (INTERMODAL STATION/AMTRAK - BUBLR BIKE STATION)",
        "pdist": 0
      },
      { . . . ***/

/**
 * updates the activeVehicle and activeRoute objects
 * @param {string} routes - comma delim list of routes to get vehicles from, max of 10
 * @return nothing
**/
async function getVehicles(routes) {
  let response
  let vehicles = {}

  apiCalls++
  console.log(`FETCH: ${BUSVEHICLES}${routes}`)

  try {
    response = await fetch(`${BUSVEHICLES}${routes}`)
    response = await response.json() // { rt: "BLU", rtnm: "Fond du Lac", rtclr: "#000000", rtdd: "BLU" }
    vehicles = response['bustime-response'].vehicle
  } catch (e) {
    console.error(`FETCH ROUTES error: not online or too many requests?
      ${e.toString()}`)
  }
  if (vehicles && vehicles.length) {
    vehicles.forEach(vehicle => {
      vehicle.updated = bustime2ms(vehicle.tmstmp)
      
      delete vehicle.tmstmp // these aren't needed
      delete vehicle.zone
      delete vehicle.mod
      delete vehicle.tablockid

      if (vehicle.vid in activeVehicles) {
        activeVehicles[vehicle.vid].unshift(Object.assign({}, vehicle))
      } else {
        activeVehicles[vehicle.vid] = [Object.assign({}, vehicle)]
      }

      if (vehicle.rt in activeRoutes) {
        activeRoutes[vehicle.rt]++
      } else {
        activeRoutes[vehicle.rt] = 1
      }

    })
  }
}

/**
 * un-mangle the time format returned from BusTime API
 * @param {string} datetime  "YYYYMMDD HH:MM:SS"
 * @return {number} milliseconds since unix epoch
**/
const bustime2ms = datetime => {
  const result = new Date()
  const parts = { setYear: [0, 4], setDate: [6, 2], setHours: [9, 2], 
                  setMinutes: [12 ,2], setSeconds: [15, 2] }
  for (let part in parts) {
    result[part](parseInt(datetime.substr(parts[part][0], parts[part][1]), 10))
  }
  result.setMonth(parseInt(datetime.substr(4, 2), 10) - 1) // grrr, stupidos!
  return result.getTime() 
}

/**
 * Returns the entire (since running) vehicles + GPS points JSON
 * THIS IS TERRIBLE, NEVER ALLOW THIS!  Let's change this to only return the
 * updates.
**/
const buses = (req, res) => res.send(JSON.stringify(activeVehicles))

/**
 * Returns the entire route list, route id, with route color and full name
**/
const routes = (req, res) => {
  const rt = getAllRoutes()
  const outx = {}
  
  rt.forEach(el => {
    outx[el] = {}
    outx[el].clr = patterns[el].clr
    outx[el].nm = patterns[el].nm
  })
  res.send(JSON.stringify(outx))
}

/**
 * Gets the last updates only, excluding vehicles which
 * haven't been updated since last sync
 * @returns nothing.    sends JSON of all updated buses
**/
const busupdates = (req, res) => {
  const updates = {}
  updRequests++
  updLastReq = Date.now()
  for (let key in activeVehicles) {
    const ve = activeVehicles[key][0]
    if (ve.updated > (sch.syncTime - (1000*60*4 /*+4min*/))) {
      updates[key] = ve
    }
  }
  res.send(JSON.stringify(updates))
}


/**
 * Get the route path/pattern (list of lat/long points)
 * @param {string} rt     The route we want the pattern for
 * @param {string{ pid    The pattern ID wanted for this route
 * @returns {object} JSON Lat/Long path of whole route, with stops 
 * @todo at this rate for a PWA, seems like a good idea to send
 *       this ONCE, brotli'd - 250k vs 5meg.  We get ~50megs as a PWA, sooo...
 *
 * @todo CTA presented a problem - at the time routeRefresh was made, a route wasn't
 *       listed on their route list; 12 hours later it was.  Since I don't think it's
 *       a new line, we might have to refresh on error, like so:
 *
 *        1. Get the new route pattern from <agency>
 *
 *        2. Insert into patterns
 *
 *        3. Write patterns (routes.json) back out
 *
 *        4. Return the pattern to the client/frontend
 *           
 *       for now I generate an error and exit.   
**/
const getPattern = (req, res) => {
  const rt = req.params.route
  const pid = req.params.pid
  if (patterns[rt] && patterns[rt].ptr) {
    patterns[rt].ptr.forEach(pat => {
      if (pat.pid == pid) {
        res.send(JSON.stringify(pat))    
      }
    })
  } else {
    console.error(`Pattern not found: rt:${rt}  pid: ${pid}  pat[rt]: ${patterns[rt]}`)
    process.exit(1)
  }
}

/**
 * Send the user information about the agency we're going to be displaying.
**/ 
const agencyconfig = (req, res) => {
  //res.header('Content-Type', 'application/json')
  res.send(JSON.stringify(agencies[TAGENCY]))
}

/**
 * load the map.   Yes there are better ways to do this, 
 * @todo - template plugin? (because of that pesky Google Maps API KEY)
**/
const map_fe = (req, res) => {
  const filePath = path.join(__dirname, '/static/buswheels.html')
  
  // @todo - verify that this was in here just for debugging and remove it.
  if (res.hasHeader('Content-Type')) {
    console.log(`DEBUG: Why here? Content-Type set.`)
  }

  res.header('Content-Type', 'text/html')
  let buf = ""
  let streamx = fs.createReadStream(filePath, {flags: 'r', encoding: 'utf-8'})
  streamx.on("data", d =>  buf += d.toString())
  streamx.on("end", d => res.send(buf.replace("${GMAPSKEY}", GMAPSKEY))) 
}

/**
 * let us know that a certain process is watching a certain bus line.
 * this will let us know to turn ON fast referencing for a line
 * @param {string} req..param.route - which route to start watching.
 * @todo - store process id too
**/
const watching = (req, res) => {
  const rt = req.params.route
  if (rt in watchList) { // @todo ugly
  } else {
    watchList[rt] = true
  } 
}

/**
 * let us know that a certain process stops watching a certain bus line.
 * this will let us know to turn off fast rerferencing of a line
 * @param {string} req.param.route - which route to finish watching.
**/
const unwatching = (req, res) => {
  const rt = req.params.route
  for (let x = 0; x !== watchList.length; x++) {
    if (watchList[x] === rt) {
      delete watchList[x]
    }
  }
}

/**
 * Make sure proper files exist, environment variables set and set correctly,
 * Will print an error message and abort if anything is wrong.
**/
const sanityChecks = () => {
  if (typeof patterns !== 'object') {
    console.error(`
      You have to run refreshRoutes.js first, you have no routes.json file!
    `)
    process.exit(1)
  }

  if (!(TAGENCY)) {
    console.error(`
      TAGENCY not set.  
      Set TAGENCY to one of the keys (${Object.keys(agencies).join(',')}) in agencies.json
    `)
    process.exit(1)
  }

  if (!(TAGENCY in agencies)) {
    console.error(`
      TAGENCY value (${TAGENCY}) isn't one of these agencies: ${Object.keys(agencies).join(',')}.
      Set TAGENCY to one of the keys (agencies) in agencies.json (or add a new one)
    `)
    process.exit(1)
  }  
  if (!(TAGENCYKEY)) {
    console.error(`
      TAGENCYKEY not set.  
      You have to get an API key to have access to a transit agency's feed.
    `)
    process.exit(1)
  }

} 

/**
 * Initialize, where everthing starts.
 * Set up our abort signal handlers, timers, set up the fastify routes, and start
 * getting active vehicles.
 *
 * @todo - we should have a setTimeout routine which
 * determines what to run next - the getAllRoutes or getActiveRoutes
 * then puts this into a file which can be pulled by an app/webpage
 * a specific express route would pull all the vehicle's current
 * rt/latlong/heading/speed, and a general timetilnextupdate field
**/
const init = () => {
  sanityChecks()

  startTime = Date.now()
  process.on('SIGINT', () => process.exit())
  process.on('exit', () => {
    let endTime= Date.now()
    let seconds = Math.floor((endTime - startTime) / 1000)
    console.log(`

      ${apiCalls} calls over ${seconds} seconds. (${seconds/apiCalls} seconds per call)
      ${updRequests} calls from front-end 🚌 🚌 🚌 🚌
    `)
  })

  BUSURL = agencies[TAGENCY].url 
  BUSVEHICLES = `${BUSURL}getvehicles?key=${TAGENCYKEY}&tmres=s&format=json&rt=`


  fastify.get('/', map_fe) // // serve the initial html
  fastify.get('/map', map_fe)  // @todo why duplicate?

  fastify.get('/buses', buses) // get evertythig. @todo: remove, wrap into busupdates
  fastify.get('/agencyconfig', agencyconfig)  // get map coords and bounds
  fastify.get('/routes', routes) // get all the routes
  fastify.get('/watching', watching) // records, but dont work yet
  fastify.get('/unwatching', unwatching) // records but dont work yet
  fastify.get('/busupdates', busupdates) // get recent bus updates
  fastify.get('/pattern/:route/pid/:pid', getPattern) // get the path latlongs for a route

  fastify.register(require('fastify-compress'), { global: true })
  fastify.register(require('fastify-static'), {
    root: path.join(__dirname, 'static'),
    prefix: '/static/', 
  })

  // I'm doing this to get around a bug in fastify-compress, where it would
  // never do dynamic brotli encoding if there were more than 1 type and it wasn't first.
  // Works now, I WIN
  fastify.addHook('preHandler', (req, reply, done) => {
    if(req.headers['accept-encoding'].includes('br')) {
      req.headers['accept-encoding'] = 'br'
    }
    done()
  })
  
  getActiveRoutes()
  setInterval(getActiveRoutes, sch.tickSpeed) // @todo this should be more attuned to changing conditions, and use sequential setTimeout() calls

  fastify.listen(port, (err, addr) => {
    if (err) {
      fastify.log.error(err)
      process.exit(1)
    } else {
      console.log(`Fastify Server @ ${addr}`)
    }
  })
}

init()
