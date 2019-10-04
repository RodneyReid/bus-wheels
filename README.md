# Bus Wheels

Bus Wheels is a real-time bus and route visualizer.  It uses nodejs/fastify on the back-end, and google maps + vanilla javascript on the front-end.

![Bus Wheels screenshot](/static/screenshot.webp)

## Installation


```bash
git install https://github.com/RodneyReid/bus-wheels.git | cd bus-wheels
```

First thing you'll need to do is get an API key for a BusTime enabled transit agency, and an API key for Google Maps, and set them:

```bash
EXPORT TAGENCY='<transit agency abbreviation>'
EXPORT TAGENCYKEY='<your api key>'
EXPORT GMAPSKEY='<your api key>'
```

For the TAGENCY, it will work with anything I have filled out in agencies.json.

And then run **refreshRoutes** to generate **routes.json**, which is a list of route patterns of latitude/longitude points, stops, and stop names we'd rather cache so we're not wasting limited (usually 10,000 a day) API calls.

```bash
node refreshRoutes
```


## Usage

Start the server.   The server does all the fetches from the BusTime API, and provides data to the front-end on demand.

```bash
node app
```
Next, pull up the front-end.   Go to **http://localhost:3000** in your browser


## Contributing
Pull requests are welcome. For major changes, please open an issue first to discuss what you would like to change.

## License
[MIT](https://choosealicense.com/licenses/mit/)