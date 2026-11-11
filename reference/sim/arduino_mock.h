// Minimal stand-in for the Arduino API so the real sketch can run inside the robot simulator.
#pragma once
#include <cstdio>
#include <cstdint>
#include <cmath>

typedef uint8_t byte;
#define HIGH 1
#define LOW 0
#define INPUT 0
#define OUTPUT 1
#define INPUT_PULLUP 2
const uint8_t A0 = 14, A1 = 15, A2 = 16, A3 = 17, A4 = 18, A5 = 19;
#define F(s) (s)
#define constrain(amt, low, high) ((amt) < (low) ? (low) : ((amt) > (high) ? (high) : (amt)))

void pinMode(uint8_t pin, uint8_t mode);
void digitalWrite(uint8_t pin, uint8_t val);
int digitalRead(uint8_t pin);
int analogRead(uint8_t pin);
void analogWrite(uint8_t pin, int val);
unsigned long millis();
void delay(unsigned long ms);

struct MockSerial {
    bool quiet = false;
    void begin(long) {}
    void print(const char *s) { if (!quiet) fputs(s, stdout); }
    void print(char c) { if (!quiet) putchar(c); }
    void print(int v) { if (!quiet) printf("%d", v); }
    void print(unsigned int v) { if (!quiet) printf("%u", v); }
    void print(long v) { if (!quiet) printf("%ld", v); }
    void print(unsigned long v) { if (!quiet) printf("%lu", v); }
    void print(double v, int digits = 2) { if (!quiet) printf("%.*f", digits, v); }
    void println() { if (!quiet) putchar('\n'); }
    template <class T> void println(T v) { print(v); println(); }
    void println(double v, int digits) { print(v, digits); println(); }
};
extern MockSerial Serial;
