package main

import (
    "fmt"
    "io"
    "net"
)

func handleConnection(conn net.Conn) {
    buf := make([]byte, 50)

    for {
        data := make([]byte, 0)
        n, e := conn.Read(buf)

        if e != nil {
            if e == io.EOF {
                break
            }
        }

        data = append(data, buf[:n]...)
        fmt.Println(data)
        conn.Write(data)

        //fmt.Println(buf)
        //mt.Println(string(buf))
    }

    //fmt.Println(data)
    //fmt.Println(string(data))

    conn.Close()
    fmt.Println("closing conn")
}

func closeConnection(listener net.Listener) {
    fmt.Println("closing listener conn")
    listener.Close()
}

func main() {

    listener, _ := net.Listen("tcp", ":8080")

    //defer listener.Close()
    defer closeConnection(listener)

    for {
        conn, _ := listener.Accept()
        go handleConnection(conn)
    }
}
