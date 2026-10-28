#include <stdio.h>
#include "util.h"

#define MAX_LEN 64

typedef struct point {
    int x;
    int y;
} Point;

static int helper(int a);

int add(int a, int b)
{
    return a + b;
}

static int helper(int a) {
    if (a > 0) {
        return a;
    }
    return 0;
}

int main(void) {
    printf("%d {\n", add(1, 2));
    return 0;
}
