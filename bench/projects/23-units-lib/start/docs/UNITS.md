# Units

Symbols are what `parse` returns and `format({ style: 'short' })` prints. Names are used by
`format` (long style); aliases are only for `parse`. Matching is case-insensitive.

## Length (base: metre)

| Symbol | Factor | Names | Aliases | Decimals |
|---|---|---|---|---|
| m | 1 | metre / metres | meter, meters | 2 |
| km | 1000 | kilometre / kilometres | kilometer, kilometers | 3 |
| cm | 0.01 | centimetre / centimetres | centimeter, centimeters | 1 |
| mm | 0.001 | millimetre / millimetres | millimeter, millimeters | 0 |
| mi | 1609.344 | mile / miles | | 2 |
| yd | 0.9144 | yard / yards | | 2 |
| ft | 0.3048 | foot / feet | ' | 2 |
| in | 0.0254 | inch / inches | " | 2 |

## Mass (base: kilogram)

| Symbol | Factor | Names | Aliases | Decimals |
|---|---|---|---|---|
| kg | 1 | kilogram / kilograms | kilo, kilos | 3 |
| g | 0.001 | gram / grams | gr | 1 |
| mg | 0.000001 | milligram / milligrams | | 0 |
| t | 1000 | tonne / tonnes | ton, tons | 3 |
| lb | 0.45359237 | pound / pounds | lbs | 2 |
| oz | 0.028349523125 | ounce / ounces | | 2 |

## Volume (base: litre)

| Symbol | Factor | Names | Aliases | Decimals |
|---|---|---|---|---|
| l | 1 | litre / litres | liter, liters | 2 |
| ml | 0.001 | millilitre / millilitres | milliliter, milliliters | 0 |
| gal | 3.785411784 | gallon / gallons | | 2 |
| qt | 0.946352946 | quart / quarts | | 2 |
| pt | 0.473176473 | pint / pints | | 2 |
| floz | 0.0295735295625 | fluid ounce / fluid ounces | fl oz | 2 |
| tbsp | 0.01478676478125 | tablespoon / tablespoons | | 1 |
| tsp | 0.00492892159375 | teaspoon / teaspoons | | 1 |

## Temperature (base: kelvin)

| Symbol | Factor | Offset | Names | Aliases | Decimals |
|---|---|---|---|---|---|
| K | 1 | 0 | kelvin / kelvins | | 1 |
| C | 1 | 273.15 | degree Celsius / degrees Celsius | °c, celsius | 1 |
| F | 5/9 | 255.3722222… (459.67 × 5/9) | degree Fahrenheit / degrees Fahrenheit | °f, fahrenheit | 1 |

## Wanted (not done yet)

| Symbol | Dimension | Factor | Names | Aliases | Decimals |
|---|---|---|---|---|---|
| nmi | length | 1852 | nautical mile / nautical miles | | 2 |
| st | mass | 6.35029318 | stone / stone | stones | 2 |
| cup | volume | 0.2365882365 | cup / cups | | 2 |

(Yes, the plural of stone as a weight is "stone": "11 stone".)
