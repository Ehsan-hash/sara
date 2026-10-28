#include <vector>
#include "shapes.hpp"

namespace geo {

class Square {
public:
    Square(double s) : side(s) {}
    double area() const { return side * side; }
private:
    double side;
};

double total(const std::vector<Square>& xs) {
    double t = 0;
    for (const auto& x : xs) t += x.area();
    return t;
}

}  // namespace geo

void geo_free_function() {
}
