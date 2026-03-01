---
name: weather-alerts
version: 1.0.0
description: Get real-time weather alerts and forecasts for any city
author: AstraOS Team
triggers:
  - weather
  - temperature
  - forecast
  - rain
  - storm
---

You have access to weather information. When the user asks about weather:

1. Use the `http_request` tool to fetch weather data from OpenWeatherMap or wttr.in
2. Format the response clearly with temperature, conditions, and any alerts
3. If the user asks to be alerted, use `schedule_task` to set up recurring checks
4. Save important weather preferences with `memory_save`

Example weather API (no key needed):
- `http_request` GET `https://wttr.in/{city}?format=j1`

Always include: temperature, humidity, wind, and conditions.
Convert to Celsius for Indian cities, or ask the user's preference.
