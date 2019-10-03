'use strict'
/**
 *  refreshRoutes makes a file of all the static route data
 * stops, color, pid/pid names, and path lat/longs
 * @author Rodney Reid
 *
 *
**/ 
const fetch = require('node-fetch')
const fs = require('fs')
const agencies = require('./agencies.json')
const { PerformanceObserver, performance } = require('perf_hooks')
const optimizeJSON = false // smaller precision lat/longs, doesn't work yet
// Set the following in your enviroment; ( export MCTSAPIKEY="----some jumble of characters---"  in shell)
const TAGENCYKEY = process.env.TAGENCYKEY // API key given by transit agency
const TAGENCY = process.env.TAGENCY // which agency?  MCTS, ACT, CTA, MTA, etc.

let BUSPATTERN
let BUSROUTES

let routes = {} // complete collection of all the fetches of routes, routeinfo, etc
let gAgency = false
/**
 * General information on all the bus routes available -- name, color, route moniker
 * @return {array} - each of the MCTS bus routes ex: { rt: "BLU", rtnm: "Fond du Lac", rtclr: "#000000", rtdd: "BLU" },
**/
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
 
/**
 * @param {string} route - the route we want patterns from
 * @return {object} route patterns
**/
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

/**
 * gets all the routes, which we bundle up and then concurrently fetch all the route patterns
**/
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

/**
 * If TAGENCY (transit agency) isn't set in shell, but TANGENCYKEY is, we want to try
 * all agencies and determine which one it is.  This should be simple - request a routelist,
 * with their TAGENCYKEY, and see which one doesn't bomb out.
 * @return {string|false} - the agency matching the API key.  Or false if not found
 * @todo - should be removed - just because I can doesn't mean I should, ha
**/
const determineAgency = () => {
  let response
  for (let agency in agencies) {
    try {
      const url = `${agencies[agency].url}getroutes?key=${TAGENCYKEY}&format=json`
      console.log(url)
      response = fetch(url)
      console.log(`FOUND.  Agency is ${agency}`)
      return agency
    } catch (e) {
      // do nothing, we'll go to the next agency
      console.log(`isn't agency ${agency}`)
    }
  }
  return false // agency wasn't discovered
}

/**
 * Initialize, sanity check env vars, get all routes and patterns
**/
const init = () => {
  if (TAGENCYKEY && TAGENCYKEY.length > 10) {
    if (TAGENCY && TAGENCY.length > 2) {
      gAgency = TAGENCY
    } else {
      gAgency = determineAgency()
    }

    if (!gAgency) {
      console.error(`I wasn't able to determine agency, aborting.`)
      process.exit(1)
    }

    BUSPATTERN = `${agencies[gAgency].url}getpatterns?key=${TAGENCYKEY}&tmres=s&format=json&rt=`
    BUSROUTES = `${agencies[gAgency].url}getroutes?key=${TAGENCYKEY}&format=json`
    getAllPatterns()

  } else {
    console.error(`env var TAGENCYKEY isn't set, aborting.`)
    process.exit(1)
  }
}

init()