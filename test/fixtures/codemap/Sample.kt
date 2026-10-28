package com.example

import kotlin.math.max

data class User(val name: String)

class Repo {
    fun find(id: Int): User? {
        return null
    }

    private fun cache() {}
}

fun topLevel(a: Int, b: Int): Int = max(a, b)

object Registry {
    fun register() {}
}
