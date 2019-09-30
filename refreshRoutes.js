// refreshRoutes makes a file of all the static route data -
// stops, color, pid/pid names, and path lat/longs
// @author Rodney Reid
//
// @todo - to incorporate more transit systems and a speedier setup:
//
// if TAGENCY (transit agency) isn't set in shell, but APIKEY is, we want to try
// all agencies and determine which one it is.  This should be simple - request a routelist,
// with their APIKEY, and see which one doesn't bomb out.
// 
// we should put something in the routes file that tells us which agency we're dealing with,
// and also puts the center lat/long, initial zoom, and bounding lat/longs in an object.
// 

'use strict'

const fetch = require('node-fetch')
const fs = require('fs')
const agencies = require('./agencies.json')
const { PerformanceObserver, performance } = require('perf_hooks')
const optimizeJSON = false // smaller precision lat/longs
// Set the following in your enviroment; ( export MCTSAPIKEY="----some jumble of characters---"  in shell)
const MCTSAPIKEY = process.env.MCTSAPIKEY // MILWAUKEE - get your own key: http://realtime.ridemcts.com/bustime/newDeveloper.jsp
const CTAAPIKEY = process.env.CTAAPIKEY // CHICAGO - get your own key: http://www.ctabustracker.com/bustime/newDeveloper.jsp


const BUSURL = 'http://realtime.ridemcts.com/bustime/api/v3/'
const CTABUSURL = 'http://www.ctabustracker.com/bustime/api/v2/'

const BUSPATTERN = `${BUSURL}getpatterns?key=${MCTSAPIKEY}&tmres=s&format=json&rt=`
const BUSROUTES = `${BUSURL}getroutes?key=${MCTSAPIKEY}&format=json`

let routes = {} // complete collection of all the fetches of routes, routeinfo, etc

// General information on all the bus routes available -- name, color, route moniker
// @return {array} - each of the MCTS bus routes ex: { rt: "BLU", rtnm: "Fond du Lac", rtclr: "#000000", rtdd: "BLU" },
async function busroutes() {
  let response
  try {
    response = await fetch(BUSROUTES)
    response = await response.json() 

    const routex = response['bustime-response'].routes
    routex.forEach(route => 
      routes[route.rt] = {
        nm: route.rtnm,
        dd: route.rtdd,
        clr: route.rtclr
      })
    return routes
  } catch (e) {
    console.error(`Can't fetch routes, aborting.`)
    process.exit()
  } 
}
 
async function getPatterns(route) {
  console.log(`${route} patterns`)
  let response
  try {
    response = await fetch(`${BUSPATTERN}${route}`)
    response = await response.json()
    if(!optimizeJSON) {
      routes[route].ptr = response['bustime-response'].ptr
    } else {
      routes[route].ptr = response['bustime-response'].ptr
      // @todo - don't run optimizeJSON true - doesn't work yet
      for (let ptr in routes[route].ptr) {
        for (let pt in routes[route].ptr[ptr]) {
          let lat = routes[route].ptr[ptr][pt].lat 
          let lon = routes[route].ptr[ptr][pt].lon
          lat = Math.floor(lat * 10000) / 10000
          lon = Math.floor(lon * 10000) / 10000
          console.log(`${pt} ${ptr} ${routes[route].ptr[ptr][pt]}`)
          routes[route].ptr[ptr][pt].lat = lat
          routes[route].ptr[ptr][pt].lon = lon
        }
      }
      routes[route].ptr = response['bustime-response'].ptr
    }
    return routes[route]
  } catch (e) {
    console.dir(e)
    console.error(`Error fetching ${BUSPATTERN}${route}  aborting.`)
    process.exit()
  }
}

async function getAllPatterns() {
  await busroutes()

  const starttime = performance.now()
  const routeKeys = Object.keys(routes)
  await Promise.all(routeKeys.map(async route => {  // 5100ms
    await getPatterns(route) 
  }))

  console.log(`Fetches done in ${Math.floor(performance.now()-starttime)}ms.    Saving routes.json`)
  fs.writeFile("routes.json", JSON.stringify(routes), 'utf8', err => {
    if (err) {
      console.log("An error occured while writing the routes out")
      console.dir(err)
    } else {
      console.log("routes have been saved.")
    }
  })  
}

getAllPatterns()
