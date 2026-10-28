package shapes

import (
	"fmt"
	str "strings"
)

import "os"

// Point is a point.
type Point struct {
	X, Y int
}

type Namer interface {
	Name() string
}

const Version = "1"

func NewPoint(x, y int) *Point {
	s := "{"
	_ = s
	return &Point{X: x, Y: y}
}

func (p *Point) String() string {
	return fmt.Sprintf("%d,%d", p.X, p.Y) + str.Repeat("", 0) + os.Getenv("")
}

func helper() {}
